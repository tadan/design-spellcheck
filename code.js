// Design Spellcheck - Figma Plugin
// IDS Hackathon Feb 6-8, 2025

figma.showUI(__html__, { width: 360, height: 640, themeColors: true });

const CODE_VERSION = '2026-02-08-01';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postProgress(percent, label) {
  figma.ui.postMessage({ type: 'progress', percent, label });
}

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function safeGetPropertyDefs(node) {
  try {
    if (
      node.type === 'COMPONENT_SET' ||
      (node.type === 'COMPONENT' && (!node.parent || node.parent.type !== 'COMPONENT_SET'))
    ) {
      return node.componentPropertyDefinitions || {};
    }
  } catch (_) {
    // variant children throw — swallow
  }
  return null;
}

function collectBoundVariables(node, set) {
  const bv = node.boundVariables;
  if (!bv) return;
  for (const val of Object.values(bv)) {
    if (Array.isArray(val)) {
      for (const v of val) {
        if (v && v.id) set.add(v.id);
      }
    } else if (val && val.id) {
      set.add(val.id);
    }
  }
}

function getVariableValueForDefaultMode(variable, collectionMap) {
  if (!variable || !variable.valuesByMode) return null;
  const col = collectionMap.get(variable.variableCollectionId);
  const modeId = col ? col.defaultModeId : null;
  const value = modeId ? variable.valuesByMode[modeId] : null;
  if (typeof value === 'number') return value;
  for (const v of Object.values(variable.valuesByMode)) {
    if (typeof v === 'number') return v;
  }
  return null;
}

function isBoundVariable(node, key) {
  if (!node || !node.boundVariables) return false;
  return Boolean(node.boundVariables[key]);
}

function pushMissed(list, node, page, propKey, propLabel, value, suggested) {
  list.push({
    id: node.id,
    name: node.name,
    type: node.type,
    page: page.name,
    path: buildParentPath(node),
    propertyKey: propKey,
    property: propLabel,
    value,
    suggestedName: suggested ? suggested.name : '',
    suggestedId: suggested ? suggested.id : '',
  });
}

function findClosestVariable(value, vars) {
  if (value === 0) {
    const noneVar = vars.find((v) => v.name.toLowerCase() === 'none');
    return noneVar || null;
  }
  let best = null;
  let bestDiff = Infinity;
  for (const v of vars) {
    if (typeof v.value !== 'number') continue;
    const diff = Math.abs(v.value - value);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = v;
    }
  }
  return best;
}

function buildParentPath(node) {
  const parts = [];
  let cur = node.parent;
  while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') {
    parts.unshift(cur.name);
    cur = cur.parent;
  }
  return parts.join(' > ');
}

function hasComponentAncestor(node) {
  let cur = node.parent;
  while (cur) {
    if (cur.type === 'COMPONENT' || cur.type === 'COMPONENT_SET' || cur.type === 'INSTANCE') {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

function isGenericName(name) {
  const generic = ['vector', 'rectangle', 'ellipse', 'line', 'group', 'frame', 'layer', 'union', 'subtract', 'intersect', 'exclude'];
  return generic.includes(stripHash(name).toLowerCase());
}

// ---------------------------------------------------------------------------
// Scan: Hidden Layers
// ---------------------------------------------------------------------------

async function scanHidden(scope) {
  postProgress(0, 'Starting hidden layer scan...');

  let pages;
  if (scope === 'file') {
    await figma.loadAllPagesAsync();
    pages = figma.root.children;
  } else {
    pages = [figma.currentPage];
  }

  const expected = [];
  const suspicious = [];
  const artifact = [];
  let visited = 0;

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    postProgress(Math.round((pi / pages.length) * 100), `Scanning page: ${page.name}`);

    const stack = [...page.children];
    while (stack.length > 0) {
      const node = stack.pop();
      visited++;

      if (visited % 1000 === 0) {
        postProgress(
          Math.round((pi / pages.length) * 100),
          `${visited.toLocaleString()} nodes scanned...`
        );
        await yieldToMain();
      }

      if (node.visible === false) {
        const item = {
          id: node.id,
          name: node.name,
          type: node.type,
          page: page.name,
          path: buildParentPath(node),
        };

        if (hasComponentAncestor(node)) {
          expected.push(item);
        } else if (
          (node.width === 0 && node.height === 0) ||
          isGenericName(node.name)
        ) {
          artifact.push(item);
        } else {
          suspicious.push(item);
        }
        // Don't recurse into hidden children
        continue;
      }

      if ('children' in node) {
        for (const child of node.children) {
          stack.push(child);
        }
      }
    }

    if (scope === 'file') await yieldToMain();
  }

  postProgress(100, 'Done');
  figma.ui.postMessage({
    type: 'hidden-results',
    categories: { expected, suspicious, artifact },
    total: expected.length + suspicious.length + artifact.length,
    visited,
  });
}

// ---------------------------------------------------------------------------
// Scan: Properties
// ---------------------------------------------------------------------------

async function scanProperties(scope) {
  postProgress(0, 'Scanning component properties...');

  let nodes;
  if (scope === 'selection') {
    nodes = figma.currentPage.selection;
    if (nodes.length === 0) {
      figma.ui.postMessage({ type: 'error', message: 'Nothing selected. Select components or instances first.' });
      return;
    }
  } else {
    nodes = figma.currentPage.children;
  }

  const noProps = [];
  const badPropNames = [];
  const badPropValues = [];
  const allDefault = [];
  const propIssueComponents = new Set();
  let totalComponents = 0;
  let totalInstances = 0;
  let instancesWithOverrides = 0;
  let visited = 0;

  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    visited++;

    if (visited % 500 === 0) {
      postProgress(50, `${visited.toLocaleString()} nodes checked...`);
      await yieldToMain();
    }

    // Check components for missing property definitions
    const defs = safeGetPropertyDefs(node);
    if (defs !== null) {
      totalComponents++;
      if (Object.keys(defs).length === 0) {
        noProps.push({
          id: node.id,
          name: node.name,
          type: node.type,
        });
      } else {
        const variantName =
          node.type === 'COMPONENT_SET'
            ? 'All variants'
            : (node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET'
              ? node.name
              : '');
        for (const [key, def] of Object.entries(defs)) {
          const nameCheck = applyNamingRules(key);
          if (nameCheck.reasons.length > 0) {
            badPropNames.push({
              id: node.id,
              name: node.name,
              type: node.type,
              variantName,
              propName: key,
              reason: nameCheck.reasons.join('; '),
              suggested: nameCheck.suggested,
            });
            propIssueComponents.add(node.id);
          }
          if (def && Array.isArray(def.variantOptions)) {
            for (const opt of def.variantOptions) {
              const valCheck = applyNamingRules(opt);
              if (valCheck.reasons.length > 0) {
                badPropValues.push({
                  id: node.id,
                  name: node.name,
                  type: node.type,
                  variantName,
                  propName: key,
                  valueName: opt,
                  reason: valCheck.reasons.join('; '),
                  suggested: valCheck.suggested,
                });
                propIssueComponents.add(node.id);
              }
            }
          }
        }
      }
    }

    // Check instances for default-only usage
    if (node.type === 'INSTANCE') {
      totalInstances++;
      try {
        const mainComp = await node.getMainComponentAsync();
        if (mainComp) {
          const compProps = node.componentProperties || {};
          const parent =
            (mainComp.parent && mainComp.parent.type === 'COMPONENT_SET')
              ? mainComp.parent
              : mainComp;
          const defaults = parent.componentPropertyDefinitions || {};

          let hasOverride = false;
          for (const [key, val] of Object.entries(compProps)) {
            const def = defaults[key];
            if (def && String(val.value) !== String(def.defaultValue)) {
              hasOverride = true;
              break;
            }
          }

          if (hasOverride) {
            instancesWithOverrides++;
          } else if (Object.keys(compProps).length > 0) {
            allDefault.push({
              id: node.id,
              name: node.name,
              componentName: mainComp.name,
              propCount: Object.keys(compProps).length,
            });
          }
        }
      } catch (_) {
        // skip inaccessible instances
      }
    }

    if ('children' in node) {
      for (const child of node.children) {
        stack.push(child);
      }
    }
  }

  postProgress(100, 'Done');
  figma.ui.postMessage({
    type: 'property-results',
    noProps,
    badPropNames,
    badPropValues,
    allDefault,
    healthy: {
      totalComponents,
      totalInstances,
      instancesWithOverrides,
      overrideRate:
        totalInstances > 0
          ? Math.round((instancesWithOverrides / totalInstances) * 100)
          : 0,
    },
    propStats: {
      totalComponents,
      componentsWithIssues: propIssueComponents.size,
    },
  });
}

// ---------------------------------------------------------------------------
// Scan: Variables
// ---------------------------------------------------------------------------

async function scanVariables(scope) {
  postProgress(0, 'Loading variable collections...');

  // Phase A: Inventory + Naming
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collectionMap = new Map(collections.map((c) => [c.id, c]));
  const allVars = [];
  const naming = { orphans: [], missingDesc: [], misplaced: [] };
  const floatVars = [];

  for (const col of collections) {
    for (const varId of col.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(varId);
      if (!v) continue;
      const entry = {
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        collection: col.name,
        collectionId: col.id,
        description: v.description,
      };
      allVars.push(entry);
      if (v.resolvedType === 'FLOAT') {
        const val = getVariableValueForDefaultMode(v, collectionMap);
        if (typeof val === 'number') {
          floatVars.push({
            id: v.id,
            name: v.name,
            collection: col.name,
            value: val,
          });
        }
      }

      // Naming checks
      if (!v.name.includes('/')) {
        naming.orphans.push({ id: v.id, name: v.name, collection: col.name });
      }
      if (!v.description || v.description.trim() === '') {
        naming.missingDesc.push({ id: v.id, name: v.name, collection: col.name });
      }
      if (
        v.name.startsWith('Global/') &&
        (v.name.toLowerCase().includes('button') ||
          v.name.toLowerCase().includes('input') ||
          v.name.toLowerCase().includes('card') ||
          v.name.toLowerCase().includes('checkbox') ||
          v.name.toLowerCase().includes('radio') ||
          v.name.toLowerCase().includes('switch') ||
          v.name.toLowerCase().includes('select') ||
          v.name.toLowerCase().includes('tab') ||
          v.name.toLowerCase().includes('modal'))
      ) {
        naming.misplaced.push({ id: v.id, name: v.name, collection: col.name });
      }
    }
  }

  postProgress(30, `Found ${allVars.length} variables. Scanning usage...`);

  // Phase B: Usage scan + missed variables
  let pages = [];
  if (scope === 'selection') {
    const sel = figma.currentPage.selection;
    if (sel.length === 0) {
      figma.ui.postMessage({ type: 'error', message: 'Nothing selected. Select layers first.' });
      return;
    }
    pages = [figma.currentPage];
  } else {
    pages = [figma.currentPage];
  }
  const usedIds = new Set();
  const missed = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    postProgress(
      30 + Math.round((pi / pages.length) * 65),
      `Scanning page ${pi + 1}/${pages.length}: ${page.name}`
    );

    const stack = (scope === 'selection' && page === figma.currentPage)
      ? [...figma.currentPage.selection]
      : [...page.children];
    while (stack.length > 0) {
      const node = stack.pop();
      collectBoundVariables(node, usedIds);
      // Spacing / padding / gap (Auto Layout)
      if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
        if (node.layoutMode && node.layoutMode !== 'NONE') {
          const props = [
            ['paddingTop', 'Padding Top'],
            ['paddingRight', 'Padding Right'],
            ['paddingBottom', 'Padding Bottom'],
            ['paddingLeft', 'Padding Left'],
            ['itemSpacing', 'Gap'],
            ['counterAxisSpacing', 'Counter Axis Gap'],
          ];
          for (const [key, label] of props) {
            const val = node[key];
            if (typeof val === 'number' && !isBoundVariable(node, key)) {
              const closest = findClosestVariable(val, floatVars);
          pushMissed(missed, node, page, key, label, val, closest);
            }
          }
        }
        // Border radius
        const radiusProps = [
          ['cornerRadius', 'Corner Radius'],
          ['topLeftRadius', 'Top Left Radius'],
          ['topRightRadius', 'Top Right Radius'],
          ['bottomLeftRadius', 'Bottom Left Radius'],
          ['bottomRightRadius', 'Bottom Right Radius'],
        ];
        for (const [key, label] of radiusProps) {
          const val = node[key];
          if (typeof val === 'number' && !isBoundVariable(node, key)) {
            const closest = findClosestVariable(val, floatVars);
            pushMissed(missed, node, page, key, label, val, closest);
          }
        }
        // Border width
        const strokeProps = [
          ['strokeWeight', 'Border Width'],
          ['strokeLeftWeight', 'Border Left Width'],
          ['strokeRightWeight', 'Border Right Width'],
          ['strokeTopWeight', 'Border Top Width'],
          ['strokeBottomWeight', 'Border Bottom Width'],
        ];
        for (const [key, label] of strokeProps) {
          const val = node[key];
          if (typeof val === 'number' && !isBoundVariable(node, key)) {
            const closest = findClosestVariable(val, floatVars);
            pushMissed(missed, node, page, key, label, val, closest);
          }
        }
        // Color variables (fills & strokes)
        if (Array.isArray(node.fills)) {
          node.fills.forEach((paint, idx) => {
            if (paint && paint.type === 'SOLID') {
              const key = `fills.${idx}`;
              if (!isBoundVariable(node, key)) {
                pushMissed(missed, node, page, key, 'Fill Color', 'Color', null);
              }
            }
          });
        }
        if (Array.isArray(node.strokes)) {
          node.strokes.forEach((paint, idx) => {
            if (paint && paint.type === 'SOLID') {
              const key = `strokes.${idx}`;
              if (!isBoundVariable(node, key)) {
                pushMissed(missed, node, page, key, 'Stroke Color', 'Color', null);
              }
            }
          });
        }
      }
      if ('children' in node) {
        for (const child of node.children) {
          stack.push(child);
        }
      }
    }

    await yieldToMain();
  }

  const unused = allVars.filter((v) => !usedIds.has(v.id));

  postProgress(100, 'Done');
  figma.ui.postMessage({
    type: 'variable-results',
    stats: {
      total: allVars.length,
      used: allVars.length - unused.length,
      unused: unused.length,
      collections: collections.length,
    },
    unused,
    naming,
    missed,
  });
}

async function removeVariable(variableId) {
  try {
    const v = await figma.variables.getVariableByIdAsync(variableId);
    if (v) {
      const name = v.name;
      v.remove();
      figma.ui.postMessage({
        type: 'variable-removed',
        variableId,
        name,
      });
    }
  } catch (e) {
    figma.ui.postMessage({
      type: 'error',
      message: `Failed to remove variable: ${e.message}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Scan: Names
// ---------------------------------------------------------------------------

// Patterns like "Frame 1", "Rectangle 47", "Group 3", "Vector 12"
var DEFAULT_NAME_RE = /^(Frame|Rectangle|Ellipse|Line|Vector|Group|Layer|Polygon|Star|Slice|Section|Component|Boolean|Union|Subtract|Intersect|Exclude|Image|Pen)\s*\d*$/i;

// Single character or two-character throwaway names
var SHORT_NAME_RE = /^.{1,2}$/;

function stripHash(name) {
  const str = String(name || '');
  const idx = str.indexOf('#');
  return idx === -1 ? str : str.slice(0, idx);
}

function isCamelCase(name) {
  return /^[a-z][a-zA-Z0-9]*$/.test(stripHash(name));
}

function applyNamingRules(raw) {
  const reasons = [];
  const base = stripHash(raw);
  let suggested = String(base || '');
  const hasSpaces = /\s/.test(suggested);
  if (hasSpaces) {
    reasons.push('No empty spaces allowed');
  }
  if (/(^|[^a-zA-Z0-9])status([^a-zA-Z0-9]|$)/i.test(suggested)) {
    reasons.push('Use "state" instead of "status"');
    suggested = suggested.replace(/status/gi, 'state');
  }
  if (/(^|[^a-zA-Z0-9])variants?([^a-zA-Z0-9]|$)/i.test(suggested) || /varian(ts|t)|varient(s)?/i.test(suggested)) {
    reasons.push('Use "variant" instead of "variants" or misspellings');
    suggested = suggested
      .replace(/variants/gi, 'variant')
      .replace(/varients/gi, 'variant')
      .replace(/varient/gi, 'variant')
      .replace(/varianst/gi, 'variant');
  }
  if (/(^|[^a-zA-Z0-9])display([^a-zA-Z0-9]|$)/i.test(suggested) ||
      /screen/i.test(suggested) ||
      /breakpoints?/i.test(suggested) ||
      /brakpoint|brekpoint|brekpoints|breakponts?/i.test(suggested)) {
    reasons.push('Use "viewport" instead of display/screen/breakpoints');
    suggested = suggested
      .replace(/display/gi, 'viewport')
      .replace(/screen/gi, 'viewport')
      .replace(/breakpoints?/gi, 'viewport')
      .replace(/brakpoint|brekpoint|brekpoints|breakponts?/gi, 'viewport');
  }
  if (!isCamelCase(base)) {
    reasons.push('Name should be camelCase');
  }
  suggested = toCamelCase(suggested);
  return { reasons, suggested };
}

async function refreshSelection(node) {
  if (!node) return;
  const alt =
    node.type === 'COMPONENT_SET' && node.children && node.children.length > 0
      ? node.children[0]
      : (node.parent && node.parent.type !== 'PAGE' ? node.parent : null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  figma.currentPage.selection = [node];
  if (alt && alt.id !== node.id) {
    figma.currentPage.selection = [alt];
  }
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}

function applyComponentPropertyDefinitions(node, newDefs) {
  let applied = false;
  try {
    if (node && node.componentPropertyDefinitions) {
      node.componentPropertyDefinitions = newDefs;
      applied = true;
    }
  } catch (_) {
    // swallow and try children
  }
  if (node && node.type === 'COMPONENT_SET' && node.children) {
    for (const child of node.children) {
      try {
        if (child && child.componentPropertyDefinitions) {
          child.componentPropertyDefinitions = newDefs;
          applied = true;
        }
      } catch (_) {
        // skip
      }
    }
  }
  return applied;
}

function getComponentPropertyDefinitions(node) {
  if (!node) return null;
  if (node.componentPropertyDefinitions) return node.componentPropertyDefinitions;
  if (node.type === 'COMPONENT_SET' && node.children && node.children.length > 0) {
    const first = node.children[0];
    return first && first.componentPropertyDefinitions ? first.componentPropertyDefinitions : null;
  }
  return null;
}

function getPropertyOrderCategory(name, defType) {
  const n = stripHash(name).toLowerCase();
  if (n.includes('size')) return 0;
  if (n.includes('state') || n.includes('status')) return 1;
  if (n.includes('variant')) return 2;
  if (String(defType).toUpperCase() === 'BOOLEAN') return 3;
  if (n.includes('label')) return 5;
  if (n.includes('text') || String(defType).toUpperCase() === 'TEXT') return 4;
  return 6;
}

function buildPropertyOrderValidation(defs) {
  const keys = Object.keys(defs || {});
  const entries = keys.map((name, index) => {
    const def = defs[name];
    const type = def ? def.type : '';
    return {
      name,
      type,
      index,
      category: getPropertyOrderCategory(name, type),
    };
  });
  const desired = entries.slice().sort((a, b) => {
    if (a.category !== b.category) return a.category - b.category;
    return a.index - b.index;
  });
  const desiredOrder = desired.map((e) => e.name);
  const desiredIndex = new Map(desiredOrder.map((n, i) => [n, i]));
  const withPositions = entries.map((e) => {
    const correctIndex = desiredIndex.get(e.name);
    return {
      name: e.name,
      type: e.type,
      index: e.index,
      correctIndex,
      wrong: e.index !== correctIndex,
    };
  });
  const totalErrors = withPositions.filter((e) => e.wrong).length;
  return { entries: withPositions, desiredOrder, totalErrors };
}

async function getEditablePropertyDefs(node) {
  if (!node) return { node: null, defs: null };
  if (node.type === 'INSTANCE') {
    const mainComp = await node.getMainComponentAsync();
    if (!mainComp) return { node: null, defs: null };
    const root = (mainComp.parent && mainComp.parent.type === 'COMPONENT_SET') ? mainComp.parent : mainComp;
    return { node: root, defs: root.componentPropertyDefinitions || {} };
  }
  if (node.type === 'COMPONENT_SET') {
    return { node, defs: node.componentPropertyDefinitions || {} };
  }
  if (node.type === 'COMPONENT') {
    return { node, defs: node.componentPropertyDefinitions || {} };
  }
  return { node: null, defs: null };
}

async function findVariableByName(name) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  for (const col of collections) {
    for (const varId of col.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(varId);
      if (v && v.name === name) return v;
    }
  }
  return null;
}

function toCamelCase(input) {
  const parts = String(input || '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0].toLowerCase();
  const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  return [first, ...rest].join('');
}

function normalizeWhitespace(name) {
  return name.replace(/\s+/g, ' ').trim();
}

function hasExtraWhitespace(name) {
  return name !== normalizeWhitespace(name);
}

function cleanTextForName(text) {
  const raw = String(text || '')
    .replace(/[#]/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();
  if (!raw) return '';
  const stop = new Set(['a','an','the','of','to','and','or','for','with','in','on','at','by']);
  const words = raw.split(/\s+/).filter(w => w && !stop.has(w.toLowerCase()));
  if (words.length === 0) return '';
  const picked = words.slice(0, 3).join(' ');
  return toCamelCase(picked);
}

function extractTextHint(node) {
  try {
    if (node.type === 'TEXT' && node.characters) {
      return cleanTextForName(node.characters);
    }
    if ('children' in node && node.children && node.children.length > 0) {
      const stack = node.children.slice(0);
      let visited = 0;
      while (stack.length > 0 && visited < 80) {
        const child = stack.pop();
        visited++;
        if (child.type === 'TEXT' && child.characters) {
          const hint = cleanTextForName(child.characters);
          if (hint) return hint;
        }
        if ('children' in child && child.children && child.children.length > 0) {
          for (const c of child.children) stack.push(c);
        }
      }
    }
  } catch (_) {
    // ignore
  }
  return '';
}

function suggestFromType(node) {
  const map = {
    FRAME: 'Frame',
    TEXT: 'Text',
    COMPONENT: 'Component',
    COMPONENT_SET: 'Component Set',
    INSTANCE: 'Instance',
    GROUP: 'Group',
    RECTANGLE: 'Rectangle',
    VECTOR: 'Vector',
    ELLIPSE: 'Ellipse',
    LINE: 'Line',
    POLYGON: 'Polygon',
    STAR: 'Star',
    SLICE: 'Slice',
    SECTION: 'Section',
    IMAGE: 'Image',
  };
  return map[node.type] || node.type;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const dp = [];
  for (let i = 0; i <= a.length; i++) {
    dp[i] = [i];
  }
  for (let j = 1; j <= b.length; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

function findClosestName(name, candidates) {
  let best = null;
  let bestDist = Infinity;
  for (const cand of candidates) {
    if (cand === name) continue;
    const dist = levenshtein(name.toLowerCase(), cand.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  if (best === null) return null;
  return { name: best, distance: bestDist };
}

function classifyName(node) {
  var issues = [];
  var name = stripHash(node.name);

  // Default/generic Figma names ("Frame 1", "Rectangle 47")
  if (DEFAULT_NAME_RE.test(name)) {
    issues.push('default');
  }

  // Very short names
  if (SHORT_NAME_RE.test(name.trim())) {
    issues.push('short');
  }

  // Unnamed auto-layout frames (default name + has auto-layout)
  if (
    node.type === 'FRAME' &&
    DEFAULT_NAME_RE.test(name) &&
    node.layoutMode && node.layoutMode !== 'NONE'
  ) {
    issues.push('autolayout');
  }

  // Non-camelCase names
  if (!isCamelCase(name)) {
    issues.push('camel');
  }

  return issues;
}

function buildNameItem(node, page, issues) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    page: page.name,
    path: buildParentPath(node),
    parentName: node.parent && node.parent.type !== 'PAGE' ? node.parent.name : '',
    contentHint: extractTextHint(node),
    issues: issues.slice(),
  };
}

function isGoodNameCandidate(name) {
  const baseName = stripHash(name);
  if (!baseName) return false;
  if (DEFAULT_NAME_RE.test(baseName)) return false;
  if (SHORT_NAME_RE.test(baseName.trim())) return false;
  return true;
}

function annotateNameItems(items, nameCounts, frequentNames, frequentCountMap) {
  for (const item of items) {
    const reasons = [];
    let suggestion = '';
    const rawName = item.name;
    const baseName = stripHash(rawName);
    const normalized = normalizeWhitespace(baseName);

    if (baseName.trim() === '') {
      reasons.push('Empty name');
    }
    if (hasExtraWhitespace(baseName)) {
      reasons.push('Contains extra whitespace');
      if (normalized !== '') suggestion = normalized;
    }
    if (item.issues.indexOf('default') !== -1) {
      reasons.push('Default Figma name');
    }
    if (item.issues.indexOf('short') !== -1) {
      reasons.push('Very short name');
    }
    if (item.issues.indexOf('autolayout') !== -1) {
      reasons.push('Auto-layout frame with default name');
    }
    if (item.issues.indexOf('camel') !== -1) {
      reasons.push('Name should be camelCase');
    }

    if (!suggestion) {
      if (item.issues.indexOf('default') !== -1) {
        reasons.push('Suggested from layer type');
        suggestion = suggestFromType({ type: item.type });
      }
    }

    if (!suggestion) {
      const close = findClosestName(baseName, frequentNames);
      const distLimit = baseName.length <= 8 ? 1 : 2;
      const closeCount = close ? (frequentCountMap.get(close.name) || 0) : 0;
      if (close && close.distance <= distLimit && closeCount >= 3) {
        reasons.push('Possible misspelling of "' + close.name + '"');
        suggestion = close.name;
      }
    }

    if (!suggestion) {
      if (item.contentHint) {
        reasons.push('Suggested from text content');
        suggestion = item.contentHint;
      }
    }

    if (!suggestion) {
      const count = nameCounts.get(baseName) || 0;
      if (count <= 1) {
        reasons.push('Name does not match other used names');
      }
      if (isGoodNameCandidate(item.parentName)) {
        suggestion = item.parentName;
      } else {
        suggestion = suggestFromType({ type: item.type });
      }
    }

    if (reasons.length === 0) {
      reasons.push('Name does not match other used names');
    }

    item.reason = reasons.join('; ');
    if (suggestion) {
      item.suggested = toCamelCase(suggestion);
    } else {
      item.suggested = '';
    }
  }
}

async function scanNames(scope) {
  postProgress(0, 'Scanning layer names...');

  var pages;
  if (scope === 'file') {
    await figma.loadAllPagesAsync();
    pages = figma.root.children;
  } else {
    pages = [figma.currentPage];
  }

  var defaultNames = [];
  var shortNames = [];
  var autolayoutNames = [];
  var nameCounts = new Map();
  var totalNodes = 0;
  var cleanNodes = 0;

  for (var pi = 0; pi < pages.length; pi++) {
    var page = pages[pi];
    postProgress(Math.round((pi / pages.length) * 100), 'Scanning: ' + page.name);

    var stack = [];
    for (var ci = 0; ci < page.children.length; ci++) {
      stack.push(page.children[ci]);
    }

    while (stack.length > 0) {
      var node = stack.pop();
      totalNodes++;
      const baseName = stripHash(node.name);
      nameCounts.set(baseName, (nameCounts.get(baseName) || 0) + 1);

      if (totalNodes % 1000 === 0) {
        postProgress(
          Math.round((pi / pages.length) * 100),
          totalNodes.toLocaleString() + ' nodes scanned...'
        );
        await yieldToMain();
      }

      // Skip nodes inside component definitions and instances (they're managed by the component author)
      if (node.type === 'INSTANCE') {
        // Count instance itself but don't recurse into it
        var instIssues = classifyName(node);
        if (instIssues.length === 0) {
          cleanNodes++;
        } else {
        var instItem = buildNameItem(node, page, instIssues);
          if (instIssues.indexOf('default') !== -1) defaultNames.push(instItem);
          if (instIssues.indexOf('short') !== -1) shortNames.push(instItem);
        }
        continue;
      }

      // Skip variant children inside component sets
      if (node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET') {
        // Variant names are structured ("Size=md, State=Default") -- skip
        if ('children' in node) {
          for (var k = 0; k < node.children.length; k++) {
            stack.push(node.children[k]);
          }
        }
        continue;
      }

      var issues = classifyName(node);

      if (issues.length === 0) {
        cleanNodes++;
      } else {
        var item = buildNameItem(node, page, issues);
        if (issues.indexOf('default') !== -1) defaultNames.push(item);
        if (issues.indexOf('short') !== -1) shortNames.push(item);
        if (issues.indexOf('autolayout') !== -1) autolayoutNames.push(item);
      }

      if ('children' in node) {
        for (var j = 0; j < node.children.length; j++) {
          stack.push(node.children[j]);
        }
      }
    }

    if (scope === 'file') await yieldToMain();
  }

  const frequentNames = [];
  const frequentCountMap = new Map();
  for (const [name, count] of nameCounts.entries()) {
    if (count >= 3 && isGoodNameCandidate(name)) {
      frequentNames.push(name);
      frequentCountMap.set(name, count);
    }
  }
  annotateNameItems(defaultNames, nameCounts, frequentNames, frequentCountMap);
  annotateNameItems(shortNames, nameCounts, frequentNames, frequentCountMap);
  annotateNameItems(autolayoutNames, nameCounts, frequentNames, frequentCountMap);

  postProgress(100, 'Done');
  figma.ui.postMessage({
    type: 'name-results',
    stats: {
      total: totalNodes,
      clean: cleanNodes,
      issues: defaultNames.length + shortNames.length + autolayoutNames.length,
    },
    defaultNames: defaultNames,
    shortNames: shortNames,
    autolayoutNames: autolayoutNames,
  });
}

// ---------------------------------------------------------------------------
// Scan: Hierarchy
// ---------------------------------------------------------------------------

async function scanHierarchy() {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Nothing selected. Select a component or instance to inspect.',
    });
    return;
  }

  postProgress(0, 'Building hierarchy tree...');
  const root = selection[0];
  const tree = await buildTree(root, 0);
  const { node: propNode, defs } = await getEditablePropertyDefs(root);
  const validation = defs ? buildPropertyOrderValidation(defs) : null;
  postProgress(100, 'Done');
  figma.ui.postMessage({
    type: 'hierarchy-results',
    tree,
    validation: validation ? {
      entries: validation.entries,
      desiredOrder: validation.desiredOrder,
      totalErrors: validation.totalErrors,
      nodeId: propNode ? propNode.id : null,
    } : null,
  });
}

async function buildTree(node, depth) {
  if (depth > 10) return null;

  const entry = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
    propertyDefs: null,
    instanceOverrides: null,
    boundVarCount: 0,
    children: [],
  };

  // Property definitions for component sets / standalone components
  const defs = safeGetPropertyDefs(node);
  if (defs !== null) {
    entry.propertyDefs = Object.entries(defs).map(([key, val]) => ({
      name: key,
      type: val.type,
      defaultValue: String(val.defaultValue),
      options: val.variantOptions || null,
    }));
  }

  // Instance overrides
  if (node.type === 'INSTANCE') {
    try {
      const mainComp = await node.getMainComponentAsync();
      if (mainComp) {
        const compProps = node.componentProperties || {};
        const parent =
          (mainComp.parent && mainComp.parent.type === 'COMPONENT_SET')
            ? mainComp.parent
            : mainComp;
        const defaults = parent.componentPropertyDefinitions || {};

        const overrides = [];
        for (const [key, val] of Object.entries(compProps)) {
          const def = defaults[key];
          if (def && String(val.value) !== String(def.defaultValue)) {
            overrides.push({
              name: key,
              value: String(val.value),
              defaultValue: String(def.defaultValue),
            });
          }
        }
        if (overrides.length > 0) {
          entry.instanceOverrides = overrides;
        }
      }
    } catch (_) {
      // skip
    }
  }

  // Bound variables count
  const bv = node.boundVariables;
  if (bv) {
    let count = 0;
    for (const val of Object.values(bv)) {
      if (Array.isArray(val)) count += val.length;
      else if (val) count++;
    }
    entry.boundVarCount = count;
  }

  // Recurse children
  if ('children' in node) {
    for (const child of node.children) {
      const childEntry = await buildTree(child, depth + 1);
      if (childEntry) entry.children.push(childEntry);
    }
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Message Dispatcher
// ---------------------------------------------------------------------------

figma.ui.onmessage = async (msg) => {
  try {
    switch (msg.type) {
      case 'scan-hidden':
        await scanHidden(msg.scope || 'page');
        break;
      case 'scan-properties':
        await scanProperties(msg.scope || 'page');
        break;
      case 'scan-variables':
        await scanVariables(msg.scope || 'page');
        break;
      case 'scan-names':
        await scanNames(msg.scope || 'page');
        break;
      case 'scan-hierarchy':
        await scanHierarchy();
        break;
      case 'ui-version':
        figma.ui.postMessage({ type: 'code-version', version: CODE_VERSION });
        break;
      case 'select-node':
        if (msg.nodeId) {
          const node = await figma.getNodeByIdAsync(msg.nodeId);
          if (node) {
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
          }
        }
        break;
      case 'select-nodes':
        if (Array.isArray(msg.nodeIds) && msg.nodeIds.length > 0) {
          const nodes = [];
          for (const id of msg.nodeIds) {
            const node = await figma.getNodeByIdAsync(id);
            if (node) nodes.push(node);
          }
          if (nodes.length > 0) {
            figma.currentPage.selection = nodes;
            figma.viewport.scrollAndZoomIntoView(nodes);
          }
        }
        break;
      case 'deselect-node':
        if (msg.nodeId) {
          const current = figma.currentPage.selection || [];
          const next = current.filter((n) => n.id !== msg.nodeId);
          figma.currentPage.selection = next;
          if (next.length > 0) {
            figma.viewport.scrollAndZoomIntoView(next);
          }
        }
        break;
      case 'deselect-nodes':
        if (Array.isArray(msg.nodeIds) && msg.nodeIds.length > 0) {
          figma.currentPage.selection = [];
        }
        break;
      case 'clear-selection':
        figma.currentPage.selection = [];
        break;
      case 'rename-prop-name':
        if (msg.nodeId && msg.oldName && typeof msg.newName === 'string') {
          const node = await figma.getNodeByIdAsync(msg.nodeId);
          if (node && node.componentPropertyDefinitions) {
            const defs = node.componentPropertyDefinitions;
            if (defs[msg.oldName]) {
              try {
                const newName = msg.newName.trim();
                if (!newName) throw new Error('Name cannot be empty.');
                const newDefs = Object.assign({}, defs);
                newDefs[newName] = defs[msg.oldName];
                delete newDefs[msg.oldName];
                const applied = applyComponentPropertyDefinitions(node, newDefs);
                if (!applied) throw new Error('Component properties not editable.');
                const updatedDefs = getComponentPropertyDefinitions(node);
                if (!updatedDefs || !updatedDefs[newName]) {
                  throw new Error('Property rename not applied (component may be published or locked).');
                }
                await refreshSelection(node);
                figma.ui.postMessage({ type: 'prop-renamed', nodeId: msg.nodeId, oldName: msg.oldName, newName });
              } catch (e) {
                figma.ui.postMessage({
                  type: 'prop-rename-failed',
                  nodeId: msg.nodeId,
                  message: e.message || String(e),
                  oldName: msg.oldName,
                });
              }
            } else {
              figma.ui.postMessage({ type: 'prop-rename-failed', nodeId: msg.nodeId, message: 'Property not found.' });
            }
          } else {
            figma.ui.postMessage({ type: 'prop-rename-failed', nodeId: msg.nodeId, message: 'Component not editable.' });
          }
        }
        break;
      case 'rename-prop-value':
        if (msg.nodeId && msg.propName && msg.oldValue && typeof msg.newValue === 'string') {
          const node = await figma.getNodeByIdAsync(msg.nodeId);
          if (node && node.componentPropertyDefinitions) {
            const defs = node.componentPropertyDefinitions;
            const def = defs[msg.propName];
            if (def && Array.isArray(def.variantOptions)) {
              try {
                const newValue = msg.newValue.trim();
                if (!newValue) throw new Error('Value cannot be empty.');
                const newOptions = def.variantOptions.map((v) => (v === msg.oldValue ? newValue : v));
                const newDef = Object.assign({}, def, { variantOptions: newOptions });
                if (String(def.defaultValue) === String(msg.oldValue)) {
                  newDef.defaultValue = newValue;
                }
                const newDefs = Object.assign({}, defs);
                newDefs[msg.propName] = newDef;
                const applied = applyComponentPropertyDefinitions(node, newDefs);
                if (!applied) throw new Error('Component properties not editable.');
                const updatedDefs = getComponentPropertyDefinitions(node);
                if (!updatedDefs || !updatedDefs[msg.propName] || !Array.isArray(updatedDefs[msg.propName].variantOptions)) {
                  throw new Error('Property values not applied (component may be published or locked).');
                }
                if (updatedDefs[msg.propName].variantOptions.indexOf(newValue) === -1) {
                  throw new Error('Property value rename not applied (component may be published or locked).');
                }
                await refreshSelection(node);
                figma.ui.postMessage({ type: 'prop-value-renamed', nodeId: msg.nodeId, propName: msg.propName, oldValue: msg.oldValue, newValue });
              } catch (e) {
                figma.ui.postMessage({
                  type: 'prop-rename-failed',
                  nodeId: msg.nodeId,
                  message: e.message || String(e),
                  propName: msg.propName,
                  oldValue: msg.oldValue,
                });
              }
            } else {
              figma.ui.postMessage({ type: 'prop-rename-failed', nodeId: msg.nodeId, message: 'Property value not editable.' });
            }
          } else {
            figma.ui.postMessage({ type: 'prop-rename-failed', nodeId: msg.nodeId, message: 'Component not editable.' });
          }
        }
        break;
      case 'remove-variable':
        if (msg.variableId) {
          await removeVariable(msg.variableId);
        }
        break;
      case 'delete-node':
        if (msg.nodeId) {
          const node = await figma.getNodeByIdAsync(msg.nodeId);
          if (node) {
            try {
              node.remove();
              figma.ui.postMessage({ type: 'node-deleted', nodeId: msg.nodeId });
            } catch (e) {
              figma.ui.postMessage({ type: 'error', message: e.message || 'Delete failed.' });
            }
          } else {
            figma.ui.postMessage({ type: 'error', message: 'Layer not found.' });
          }
        }
        break;
      case 'rename-node':
        if (msg.nodeId && typeof msg.newName === 'string') {
          const newName = msg.newName.trim();
          if (newName.length === 0) {
            figma.ui.postMessage({
              type: 'rename-failed',
              nodeId: msg.nodeId,
              message: 'Name cannot be empty.',
            });
            break;
          }
          const node = await figma.getNodeByIdAsync(msg.nodeId);
          if (node) {
            node.name = newName;
            figma.ui.postMessage({
              type: 'node-renamed',
              nodeId: msg.nodeId,
              newName,
            });
          } else {
            figma.ui.postMessage({
              type: 'rename-failed',
              nodeId: msg.nodeId,
              message: 'Layer not found (maybe in an unloaded page).',
            });
          }
        }
        break;
      case 'fix-hierarchy':
        if (msg.nodeId && Array.isArray(msg.desiredOrder)) {
          const rawNode = await figma.getNodeByIdAsync(msg.nodeId);
          const editable = await getEditablePropertyDefs(rawNode);
          const targetNode = editable.node;
          const defs = editable.defs;
          if (targetNode && defs) {
            if (Object.keys(defs).length === 0) {
              figma.ui.postMessage({ type: 'error', message: 'No component properties found to reorder.' });
              break;
            }
            const newDefs = {};
            for (const name of msg.desiredOrder) {
              if (defs[name]) newDefs[name] = defs[name];
            }
            const candidates = [];
            candidates.push(targetNode);
            if (targetNode.parent && targetNode.parent.type === 'COMPONENT_SET') {
              candidates.push(targetNode.parent);
            }
            let applied = false;
            let appliedNode = null;
            for (const cand of candidates) {
              if (applyComponentPropertyDefinitions(cand, newDefs)) {
                applied = true;
                appliedNode = cand;
                break;
              }
            }
            if (!applied || !appliedNode) {
              figma.ui.postMessage({
                type: 'error',
                message: 'Component properties not editable (component may be locked or from a library).',
              });
              break;
            }
            const updatedDefs = getComponentPropertyDefinitions(appliedNode);
            const updatedOrder = updatedDefs ? Object.keys(updatedDefs) : [];
            const sameOrder = updatedOrder.length === msg.desiredOrder.length &&
              updatedOrder.every((n, i) => n === msg.desiredOrder[i]);
            if (!sameOrder) {
              figma.ui.postMessage({ type: 'error', message: 'Hierarchy fix not applied (component may be locked).' });
              break;
            }
            await refreshSelection(appliedNode);
            figma.ui.postMessage({ type: 'hierarchy-fixed' });
          } else {
            figma.ui.postMessage({ type: 'error', message: 'Hierarchy fix not available.' });
          }
        }
        break;
      case 'bind-variable':
        if (msg.nodeId && msg.propertyKey && (msg.variableId || msg.variableName)) {
          try {
            const node = await figma.getNodeByIdAsync(msg.nodeId);
            if (!node) throw new Error('Node not found.');
            let variable = null;
            if (msg.variableId) {
              variable = await figma.variables.getVariableByIdAsync(msg.variableId);
            }
            if (!variable && msg.variableName) {
              if (msg.variableName === '0') throw new Error('Variable "0" is not allowed.');
              variable = await findVariableByName(msg.variableName);
            }
            if (!variable) throw new Error('Variable not found.');
            if (typeof node.setBoundVariable !== 'function') {
              throw new Error('Variable binding not supported for this node.');
            }
            node.setBoundVariable(msg.propertyKey, variable);
            figma.ui.postMessage({
              type: 'variable-bound',
              nodeId: msg.nodeId,
              propertyKey: msg.propertyKey,
              variableId: variable.id,
              variableName: variable.name,
            });
          } catch (e) {
            figma.ui.postMessage({
              type: 'variable-bind-failed',
              nodeId: msg.nodeId,
              propertyKey: msg.propertyKey,
              message: e.message || String(e),
            });
          }
        }
        break;
    }
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: e.message || String(e) });
  }
};
