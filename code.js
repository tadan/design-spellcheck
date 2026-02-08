// Design Spellcheck - Figma Plugin
// IDS Hackathon 2026

figma.showUI(__html__, { width: 400, height: 644, themeColors: true });

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

figma.ui.onmessage = async (msg) => {
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
};

async function scanProperties() {
  figma.ui.postMessage({ type: 'progress', percent: 0 });

  const issues = [];
  const nodes = figma.currentPage.findAll();

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Check for default/generic names
    if (/^(Frame|Rectangle|Ellipse|Line|Vector|Group|Text)\s+\d+$/.test(node.name)) {
      issues.push({
        id: node.id,
        label: 'Name',
        name: node.name
      });
    }

    if (i % 100 === 0) {
      figma.ui.postMessage({ type: 'progress', percent: Math.round((i / nodes.length) * 100) });
    }
  }

  figma.ui.postMessage({ type: 'progress', percent: 100 });
  figma.ui.postMessage({
    type: 'properties-results',
    issues: issues.length > 0 ? [{
      title: 'Properties',
      count: issues.length,
      items: issues.slice(0, 50)
    }] : []
  });
}

async function scanHierarchy() {
  figma.ui.postMessage({ type: 'progress', percent: 0 });

  const issues = [];
  const nodes = figma.currentPage.findAll();

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Check for components without properties
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      try {
        // Skip variant children - they can't have componentPropertyDefinitions accessed
        if (node.parent && node.parent.type === 'COMPONENT_SET') {
          continue;
        }

        const props = node.componentPropertyDefinitions || {};
        if (Object.keys(props).length === 0) {
          issues.push({
            id: node.id,
            label: 'Name',
            name: node.name
          });
        }
      } catch (e) {
        // Silently skip nodes that can't be accessed
      }
    }

    if (i % 100 === 0) {
      figma.ui.postMessage({ type: 'progress', percent: Math.round((i / nodes.length) * 100) });
    }
  }

  figma.ui.postMessage({ type: 'progress', percent: 100 });
  figma.ui.postMessage({
    type: 'hierarchy-results',
    issues: issues.length > 0 ? [{
      title: 'Hierarchy',
      count: issues.length,
      items: issues.slice(0, 50)
    }] : []
  });
}

async function scanLayers() {
  figma.ui.postMessage({ type: 'progress', percent: 0 });

  const issues = [];
  const nodes = figma.currentPage.findAll(n => n.visible === false);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    issues.push({
      id: node.id,
      label: 'Name',
      name: node.name
    });

    if (i % 50 === 0) {
      figma.ui.postMessage({ type: 'progress', percent: Math.round((i / nodes.length) * 100) });
    }
  }

  figma.ui.postMessage({ type: 'progress', percent: 100 });
  figma.ui.postMessage({
    type: 'layers-results',
    issues: issues.length > 0 ? [{
      title: 'Hidden',
      count: issues.length,
      items: issues.slice(0, 50)
    }] : []
  });
}

async function scanVariables() {
  figma.ui.postMessage({ type: 'progress', percent: 0 });

  const localVariables = figma.variables.getLocalVariables();
  const allNodes = figma.currentPage.findAll();

  // Find bound variables
  const boundVariables = new Set();
  for (let i = 0; i < allNodes.length; i++) {
    const node = allNodes[i];
    const bv = node.boundVariables;

    if (bv) {
      for (const val of Object.values(bv)) {
        if (Array.isArray(val)) {
          for (const v of val) {
            if (v && v.id) boundVariables.add(v.id);
          }
        } else if (val && val.id) {
          boundVariables.add(val.id);
        }
      }
    }

    if (i % 100 === 0) {
      figma.ui.postMessage({ type: 'progress', percent: Math.round((i / allNodes.length) * 50) });
    }
  }

  // Find unused
  const unused = [];
  for (let i = 0; i < localVariables.length; i++) {
    const variable = localVariables[i];
    if (!boundVariables.has(variable.id)) {
      unused.push({
        id: variable.id,
        label: 'Name',
        name: variable.name
      });
    }

    if (i % 50 === 0) {
      figma.ui.postMessage({ type: 'progress', percent: 50 + Math.round((i / localVariables.length) * 50) });
    }
  }

  figma.ui.postMessage({ type: 'progress', percent: 100 });
  figma.ui.postMessage({
    type: 'variables-results',
    issues: unused.length > 0 ? [{
      title: 'Variables',
      count: unused.length,
      items: unused.slice(0, 50)
    }] : []
  });
}
