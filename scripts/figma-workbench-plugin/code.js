figma.showUI(__html__, { width: 380, height: 300 });

figma.ui.onmessage = async (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'plugin-status') {
    figma.ui.postMessage(pluginStatus());
    return;
  }
  if (message.type === 'create-test-text') {
    try {
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      const text = figma.createText();
      text.name = 'mcp_test_workbench_plugin';
      text.characters = 'mcp_test_workbench_plugin';
      text.fontSize = 18;
      text.x = 120;
      text.y = 120;
      figma.currentPage.appendChild(text);
      figma.currentPage.selection = [text];
      figma.viewport.scrollAndZoomIntoView([text]);
      figma.ui.postMessage({
        type: 'test-result',
        ok: true,
        createdNodeIds: [text.id],
        mutatedNodeIds: [text.id],
        ...pluginStatus()
      });
    } catch (error) {
      figma.ui.postMessage({
        type: 'test-result',
        ok: false,
        error: error && error.message ? error.message : String(error),
        ...pluginStatus()
      });
    }
  }
};

figma.ui.postMessage(pluginStatus());

function pluginStatus() {
  return {
    type: 'plugin-status',
    fileKey: figma.fileKey || '',
    fileName: figma.root && figma.root.name ? figma.root.name : '',
    pageName: figma.currentPage && figma.currentPage.name ? figma.currentPage.name : '',
    pluginVersion: '2026-07-09-direct-workbench'
  };
}
