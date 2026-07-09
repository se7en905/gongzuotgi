figma.showUI(__html__, { width: 360, height: 280 });

figma.ui.onmessage = async (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'plugin-status') {
    figma.ui.postMessage(pluginStatus());
    return;
  }
  if (message.type === 'bridge-task') {
    const task = message.task || {};
    try {
      const result = await runBridgeTask(task);
      figma.ui.postMessage({
        type: 'bridge-task-result',
        id: task.id,
        ok: true,
        ...pluginStatus(),
        ...result
      });
    } catch (error) {
      figma.ui.postMessage({
        type: 'bridge-task-result',
        id: task.id,
        ok: false,
        error: error && error.message ? error.message : String(error),
        ...pluginStatus()
      });
    }
  }
};

figma.ui.postMessage(pluginStatus());

async function runBridgeTask(task) {
  const type = String(task.type || '').trim();
  if (type === 'create-text') return createTextNode(task);
  throw new Error(`暂不支持的桥接任务类型：${type || 'unknown'}`);
}

async function createTextNode(task) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const text = figma.createText();
  text.name = 'mcp_test_figma_bridge';
  text.characters = String(task.text || 'mcp_test_figma_bridge');
  text.fontSize = 18;
  text.x = Number.isFinite(Number(task.x)) ? Number(task.x) : 120;
  text.y = Number.isFinite(Number(task.y)) ? Number(task.y) : 120;
  figma.currentPage.appendChild(text);
  figma.currentPage.selection = [text];
  figma.viewport.scrollAndZoomIntoView([text]);
  return {
    createdNodeIds: [text.id],
    mutatedNodeIds: [text.id]
  };
}

function pluginStatus() {
  return {
    type: 'plugin-status',
    fileKey: figma.fileKey || '',
    fileName: figma.root && figma.root.name ? figma.root.name : '',
    pageName: figma.currentPage && figma.currentPage.name ? figma.currentPage.name : '',
    pluginVersion: '2026-07-09-minimal'
  };
}
