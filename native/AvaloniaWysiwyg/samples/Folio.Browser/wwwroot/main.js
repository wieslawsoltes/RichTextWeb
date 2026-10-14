import { dotnet } from './_framework/dotnet.js';

try {
  const runtime = await dotnet.withDiagnosticTracing(false).withApplicationArgumentsFromQuery().create();
  const automation = new URLSearchParams(location.search).get('automation') === '1';
  runtime.setModuleImports('folio-host', {
    isAutomation: () => automation,
    readDraft: () => localStorage.getItem('folio.native.draft.v1'),
    writeDraft: text => localStorage.setItem('folio.native.draft.v1', text),
    ready: () => { document.getElementById('boot').hidden = true; window.__folioReady = true; },
    download: (name, text) => {
      const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.folio') ? 'application/json' : 'text/plain';
      const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  });
  const config = runtime.getConfig();
  if (automation) {
    const exports = await runtime.getAssemblyExports(config.mainAssemblyName);
    const bridge = exports.Folio.Browser.BrowserBridge;
    window.folio = {
      state: () => JSON.parse(bridge.State()),
      act: (action, argument = '') => { const result = bridge.Act(action, String(argument)); return ['json','html','markdown'].includes(action) ? result : JSON.parse(result); },
      bounds: name => JSON.parse(bridge.Bounds(name)),
      caret: position => JSON.parse(bridge.Caret(position)),
      objectBounds: id => JSON.parse(bridge.ObjectBounds(id))
    };
  }
  await runtime.runMain(config.mainAssemblyName, [location.href]);
} catch (error) {
  window.__folioStartupError = String(error?.stack || error);
  const boot = document.getElementById('boot'); boot.classList.add('error'); boot.textContent = `Folio could not start.\n${error?.message || error}`;
  console.error(error);
}
