// CLOS-UI - Design Spellcheck
// IDS Hackathon 2026

figma.showUI(__html__, { width: 400, height: 644, themeColors: true });

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

// Track selection
figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection;
  if (selection.length > 0) {
    const node = selection[0];
    figma.ui.postMessage({
      type: 'selection-changed',
      name: node.name,
      hasSelection: true
    });
  } else {
    figma.ui.postMessage({
      type: 'selection-changed',
      hasSelection: false
    });
  }
});

// ---------------------------------------------------------------------------
// Message Dispatcher
// ---------------------------------------------------------------------------

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'scan-properties') {
      await scanProperties();
    } else if (msg.type === 'scan-hierarchy') {
      await scanHierarchy();
    } else if (msg.type === 'scan-layers') {
      await scanLayers();
    } else if (msg.type === 'scan-variables') {
      await scanVariables();
    } else if (msg.type === 'select-node') {
      const node = await figma.getNodeByIdAsync(msg.nodeId);
      if (node) {
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
      }
    }
  } catch (e) {
    figma.ui.postMessage({
      type: 'error',
      message: e.message || String(e)
    });
  }
};

// ---------------------------------------------------------------------------
// Scan: Properties
// ---------------------------------------------------------------------------

async function scanProperties() {
  postProgress(0, 'Scanning component properties...');

  const nodes = figma.currentPage.children;
  const noProps = [];
  const allDefault = [];
  let totalComponents = 0;
  let totalInstances = 0;
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
          label: 'Component',
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

          if (!hasOverride && Object.keys(compProps).length > 0) {
            allDefault.push({
              id: node.id,
              label: 'Instance',
              name: `${node.name} (${mainComp.name})`,
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

  // Format results for simple UI
  const issues = [];

  if (noProps.length > 0) {
    issues.push({
      title: 'Components Without Properties',
      count: noProps.length,
      items: noProps.slice(0, 50)
    });
  }

  if (allDefault.length > 0) {
    issues.push({
      title: 'Instances Using Only Defaults',
      count: allDefault.length,
      items: allDefault.slice(0, 50)
    });
  }

  figma.ui.postMessage({
    type: 'properties-results',
    issues
  });
}

// ---------------------------------------------------------------------------
// Scan: Hierarchy
// ---------------------------------------------------------------------------

async function scanHierarchy() {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'hierarchy-results',
      issues: []
    });
    return;
  }

  postProgress(0, 'Building hierarchy tree...');
  const root = selection[0];

  // For simple UI, just show basic info
  const issues = [];

  const defs = safeGetPropertyDefs(root);
  if (defs !== null && Object.keys(defs).length > 0) {
    issues.push({
      title: 'Component Properties',
      count: Object.keys(defs).length,
      items: Object.entries(defs).slice(0, 20).map(([key, val]) => ({
        id: root.id,
        label: val.type,
        name: key
      }))
    });
  }

  // Count bound variables
  const bv = root.boundVariables;
  if (bv) {
    let varCount = 0;
    for (const val of Object.values(bv)) {
      if (Array.isArray(val)) varCount += val.length;
      else if (val) varCount++;
    }
    if (varCount > 0) {
      issues.push({
        title: 'Bound Variables',
        count: varCount,
        items: [{ id: root.id, label: 'Variables', name: `${varCount} variable(s) bound` }]
      });
    }
  }

  // Count children
  if ('children' in root) {
    issues.push({
      title: 'Children',
      count: root.children.length,
      items: root.children.slice(0, 20).map(child => ({
        id: child.id,
        label: child.type,
        name: child.name
      }))
    });
  }

  postProgress(100, 'Done');
  figma.ui.postMessage({
    type: 'hierarchy-results',
    issues: issues.length > 0 ? issues : []
  });
}

// ---------------------------------------------------------------------------
// Scan: Hidden Layers
// ---------------------------------------------------------------------------

async function scanLayers() {
  postProgress(0, 'Starting hidden layer scan...');

  const page = figma.currentPage;
  const expected = [];
  const suspicious = [];
  const artifact = [];
  let visited = 0;

  const stack = [...page.children];
  while (stack.length > 0) {
    const node = stack.pop();
    visited++;

    if (visited % 1000 === 0) {
      postProgress(50, `${visited.toLocaleString()} nodes scanned...`);
      await yieldToMain();
    }

    if (node.visible === false) {
      const item = {
        id: node.id,
        name: node.name,
        type: node.type,
        label: 'Hidden',
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

  postProgress(100, 'Done');

  const issues = [];

  if (suspicious.length > 0) {
    issues.push({
      title: 'Suspicious Hidden Layers',
      count: suspicious.length,
      items: suspicious.slice(0, 50)
    });
  }

  if (artifact.length > 0) {
    issues.push({
      title: 'Hidden Artifacts',
      count: artifact.length,
      items: artifact.slice(0, 50)
    });
  }

  if (expected.length > 0) {
    issues.push({
      title: 'Expected (In Components)',
      count: expected.length,
      items: expected.slice(0, 50)
    });
  }

  figma.ui.postMessage({
    type: 'layers-results',
    issues
  });
}

// ---------------------------------------------------------------------------
// Scan: Variables
// ---------------------------------------------------------------------------

async function scanVariables() {
  postProgress(0, 'Loading variable collections...');

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const allVars = [];
  const orphans = [];
  const missingDesc = [];

  for (const col of collections) {
    for (const varId of col.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(varId);
      if (!v) continue;

      allVars.push({
        id: v.id,
        name: v.name,
        collection: col.name,
      });

      // Naming checks
      if (!v.name.includes('/')) {
        orphans.push({
          id: v.id,
          label: 'Orphan',
          name: `${v.name} (${col.name})`
        });
      }
      if (!v.description || v.description.trim() === '') {
        missingDesc.push({
          id: v.id,
          label: 'No description',
          name: `${v.name} (${col.name})`
        });
      }
    }
  }

  postProgress(30, `Found ${allVars.length} variables. Scanning usage...`);

  // Find used variables
  const usedIds = new Set();
  const page = figma.currentPage;
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

  const unused = allVars.filter(v => !usedIds.has(v.id)).map(v => ({
    id: v.id,
    label: 'Unused',
    name: `${v.name} (${v.collection})`
  }));

  postProgress(100, 'Done');

  const issues = [];

  if (unused.length > 0) {
    issues.push({
      title: 'Unused Variables',
      count: unused.length,
      items: unused.slice(0, 50)
    });
  }

  if (orphans.length > 0) {
    issues.push({
      title: 'Variables Without Groups',
      count: orphans.length,
      items: orphans.slice(0, 50)
    });
  }

  if (missingDesc.length > 0) {
    issues.push({
      title: 'Variables Without Descriptions',
      count: missingDesc.length,
      items: missingDesc.slice(0, 50)
    });
  }

  figma.ui.postMessage({
    type: 'variables-results',
    issues
  });
}
