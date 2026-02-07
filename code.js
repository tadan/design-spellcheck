// Design Spellcheck - Figma Plugin
// IDS Hackathon Feb 6-8, 2025

figma.showUI(__html__, { width: 360, height: 640, themeColors: true });

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
  const generic = ['Vector', 'Rectangle', 'Ellipse', 'Line', 'Group', 'Frame', 'Union', 'Subtract', 'Intersect', 'Exclude'];
  return generic.includes(name);
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
  const allDefault = [];
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
  });
}

// ---------------------------------------------------------------------------
// Scan: Variables
// ---------------------------------------------------------------------------

async function scanVariables() {
  postProgress(0, 'Loading variable collections...');

  // Phase A: Inventory + Naming
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const allVars = [];
  const naming = { orphans: [], missingDesc: [], misplaced: [] };

  for (const col of collections) {
    for (const varId of col.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(varId);
      if (!v) continue;
      allVars.push({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        collection: col.name,
        collectionId: col.id,
        description: v.description,
      });

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

  // Phase B: Usage scan
  await figma.loadAllPagesAsync();
  const pages = figma.root.children;
  const usedIds = new Set();

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    postProgress(
      30 + Math.round((pi / pages.length) * 65),
      `Scanning page ${pi + 1}/${pages.length}: ${page.name}`
    );

    const stack = [...page.children];
    while (stack.length > 0) {
      const node = stack.pop();
      collectBoundVariables(node, usedIds);
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
var DEFAULT_NAME_RE = /^(Frame|Rectangle|Ellipse|Line|Vector|Group|Polygon|Star|Slice|Section|Component|Boolean|Union|Subtract|Intersect|Exclude|Image|Pen)\s*\d*$/;

// Single character or two-character throwaway names
var SHORT_NAME_RE = /^.{1,2}$/;

function classifyName(node) {
  var issues = [];
  var name = node.name;

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

  return issues;
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
          var instItem = {
            id: node.id,
            name: node.name,
            type: node.type,
            page: page.name,
            path: buildParentPath(node),
          };
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
        var item = {
          id: node.id,
          name: node.name,
          type: node.type,
          page: page.name,
          path: buildParentPath(node),
        };
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
  postProgress(100, 'Done');
  figma.ui.postMessage({ type: 'hierarchy-results', tree });
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
        await scanVariables();
        break;
      case 'scan-names':
        await scanNames(msg.scope || 'page');
        break;
      case 'scan-hierarchy':
        await scanHierarchy();
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
      case 'remove-variable':
        if (msg.variableId) {
          await removeVariable(msg.variableId);
        }
        break;
    }
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: e.message || String(e) });
  }
};
