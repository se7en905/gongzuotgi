figma.showUI(__html__, { width: 380, height: 300 });

const platformBases = __ART_PLATFORM_BASES__;
const pluginBinding = __ART_PLUGIN_BINDING__;

figma.ui.onmessage = async (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'plugin-status') {
    figma.ui.postMessage(pluginStatus());
    return;
  }
  if (message.type === 'heartbeat') {
    const result = await sendHeartbeat(message.payload || {});
    figma.ui.postMessage({
      type: 'heartbeat-result',
      ...result
    });
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

async function sendHeartbeat(payload = {}) {
  const mergedPayload = {
    ...payload,
    bindingToken: pluginBinding.token || payload.bindingToken || '',
    boundUserId: pluginBinding.userId || payload.boundUserId || '',
    boundUsername: pluginBinding.username || payload.boundUsername || '',
    boundDisplayName: pluginBinding.displayName || payload.boundDisplayName || ''
  };
  let lastError = '';
  for (const base of platformBases) {
    try {
      const response = await fetch(`${base}/api/figma-plugin/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergedPayload)
      });
      const data = await response.json();
      if (data.ok === true) {
        return { ok: true, base, fallback: false, data };
      }
      lastError = data.error || `HTTP ${response.status}`;
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      try {
        await fetch(`${base}/api/figma-plugin/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ ...mergedPayload, corsFallback: true })
        });
        return { ok: true, base, fallback: true, data: null };
      } catch (fallbackError) {
        lastError = `${lastError}; 兼容模式：${fallbackError && fallbackError.message ? fallbackError.message : String(fallbackError)}`;
      }
    }
  }
  return { ok: false, base: '', error: lastError || '所有工作台地址都不可访问' };
}
