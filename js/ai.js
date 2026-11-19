/* ai.js — Yapay zekâ sağlayıcıları. Her biri resmi REST API'si ile doğrudan tarayıcıdan çağrılır.
 * API anahtarları yalnızca bu cihazda, şifreli gizli kayıtta (Store.setSecret: kilit açıksa PIN anahtarıyla, değilse cihaz anahtarıyla) saklanır; yalnızca seçilen sağlayıcıya gönderilir. */
(function (root) {
  'use strict';
  var PROVIDERS = {
    gemini: { label: 'Google Gemini', free: 'Ücretsiz katman var', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey',
      model: 'gemini-2.5-flash', vision: true, cors: 'Tarayıcıdan doğrudan çalışır.' },
    groq: { label: 'Groq', free: 'Ücretsiz katman var', needsKey: true, keyUrl: 'https://console.groq.com/keys',
      model: 'llama-3.3-70b-versatile', visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct', vision: true, cors: 'Tarayıcıdan doğrudan çalışır.' },
    openrouter: { label: 'OpenRouter', free: 'Ücretsiz modeller var (adı ":free" ile biter)', needsKey: true, keyUrl: 'https://openrouter.ai/keys',
      model: 'meta-llama/llama-3.3-70b-instruct:free', vision: true, cors: 'Tarayıcıdan doğrudan çalışır. Engellenen sağlayıcıların modellerine (OpenAI, Claude, Grok) buradan da ulaşabilirsin.' },
    ollama: { label: 'Ollama (bilgisayarında, internetsiz)', free: 'Tamamen ücretsiz, anahtar gerekmez', needsKey: false, keyUrl: 'https://ollama.com/download',
      model: 'llama3.2', visionModel: 'llama3.2-vision', vision: true, baseUrl: 'http://localhost:11434',
      cors: 'Ollama\'yı OLLAMA_ORIGINS="*" ortam değişkeniyle başlatman gerekir, yoksa tarayıcı engeller.' },
    openai: { label: 'OpenAI (ChatGPT)', free: 'Ücretli', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys',
      model: 'gpt-4.1-mini', vision: true, cors: 'Kasım 2026 testinde tarayıcıdan erişilebiliyordu. Engellenirse OpenRouter üzerinden "openai/..." modellerini kullan.' },
    anthropic: { label: 'Anthropic (Claude)', free: 'Ücretli', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys',
      model: 'claude-sonnet-4-5', vision: true, cors: 'Özel tarayıcı izni başlığıyla çalışır.' },
    xai: { label: 'xAI (Grok)', free: 'Ücretli', needsKey: true, keyUrl: 'https://console.x.ai',
      model: 'grok-4', vision: true, cors: 'Kasım 2026 testinde tarayıcıdan erişilebiliyordu. İleride tarayıcı güvenliği (CORS) engellerse OpenRouter üzerinden "x-ai/..." modellerini kullan.' }
  };
  var OPENAI_COMPAT = { groq: 'https://api.groq.com/openai/v1', openrouter: 'https://openrouter.ai/api/v1', openai: 'https://api.openai.com/v1', xai: 'https://api.x.ai/v1' };

  function fetchJson(url, opts, timeoutMs) {
    var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 120000);
    opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (r) {
      clearTimeout(t);
      return r.text().then(function (txt) {
        var j = null; try { j = JSON.parse(txt); } catch (e) { /* */ }
        if (!r.ok) {
          var msg = (j && (j.error && (j.error.message || j.error) || j.message)) || txt.slice(0, 300);
          var hint = r.status === 401 || r.status === 403 || (r.status === 400 && /api.?key|unauthori|invalid.*key/i.test(JSON.stringify(msg))) ? 'API anahtarı hatalı veya yetkisiz. ' : r.status === 429 ? 'Kota/limit doldu, biraz bekle veya başka sağlayıcı seç. ' : r.status === 404 ? 'Model adı bulunamadı; "Modelleri listele" ile doğru adı seç. ' : '';
          throw new Error(hint + '(HTTP ' + r.status + ') ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)));
        }
        if (!j) throw new Error('Sağlayıcıdan geçersiz yanıt geldi');
        return j;
      });
    }, function (e) {
      clearTimeout(t);
      if (e.name === 'AbortError') throw new Error('Zaman aşımı: sağlayıcı yanıt vermedi.');
      throw new Error('Bağlantı kurulamadı. İnternetini kontrol et; sorun sürerse bu sağlayıcı tarayıcıdan erişimi (CORS) engelliyor olabilir. OpenRouter veya Gemini dene.');
    });
  }

  /* messages: [{role:'user'|'assistant', text, images:[{mime, data(base64)}]}] */
  function chat(cfg, system, messages, wantVision) {
    var p = PROVIDERS[cfg.provider]; if (!p) return Promise.reject(new Error('Sağlayıcı seçilmedi'));
    var key = (cfg.keys || {})[cfg.provider] || '';
    if (p.needsKey && !key) return Promise.reject(new Error(p.label + ' için API anahtarı girilmemiş (Asistan > Ayarlar).'));
    var models = (cfg.models || {})[cfg.provider] || {};
    var model = (wantVision ? (models.vision || p.visionModel || models.chat || p.model) : (models.chat || p.model));
    var hasImg = messages.some(function (m) { return m.images && m.images.length; });

    if (cfg.provider === 'gemini') {
      var body = { contents: messages.map(function (m) {
        var parts = [{ text: m.text }];
        (m.images || []).forEach(function (im) { parts.push({ inline_data: { mime_type: im.mime, data: im.data } }); });
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: parts };
      }), generationConfig: { temperature: 0.2 } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      return fetchJson('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (j) {
        var c = j.candidates && j.candidates[0];
        if (!c || !c.content) throw new Error('Gemini boş yanıt döndü' + (c && c.finishReason ? ' (' + c.finishReason + ')' : ''));
        return c.content.parts.map(function (x) { return x.text || ''; }).join('');
      });
    }
    if (cfg.provider === 'anthropic') {
      return fetchJson('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: model, max_tokens: 4096, temperature: 0.2, system: system || undefined, messages: messages.map(function (m) {
          var content = (m.images || []).map(function (im) { return { type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } }; });
          content.push({ type: 'text', text: m.text });
          return { role: m.role, content: content };
        }) }) }).then(function (j) { return (j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join(''); });
    }
    if (cfg.provider === 'ollama') {
      var base = (cfg.ollamaUrl || p.baseUrl).replace(/\/$/, '');
      var msgs = (system ? [{ role: 'system', content: system }] : []).concat(messages.map(function (m) {
        var o = { role: m.role, content: m.text }; if (m.images && m.images.length) o.images = m.images.map(function (im) { return im.data; }); return o;
      }));
      return fetchJson(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model, messages: msgs, stream: false, options: { temperature: 0.2 } }) }, 300000)
        .then(function (j) { return (j.message && j.message.content) || ''; });
    }
    // OpenAI uyumlu: groq, openrouter, openai, xai
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
    if (cfg.provider === 'openrouter') { headers['X-Title'] = 'Finans Pusulasi'; }
    var omsgs = (system ? [{ role: 'system', content: system }] : []).concat(messages.map(function (m) {
      if (!m.images || !m.images.length) return { role: m.role, content: m.text };
      return { role: m.role, content: [{ type: 'text', text: m.text }].concat(m.images.map(function (im) { return { type: 'image_url', image_url: { url: 'data:' + im.mime + ';base64,' + im.data } }; })) };
    }));
    return fetchJson(OPENAI_COMPAT[cfg.provider] + '/chat/completions', { method: 'POST', headers: headers, body: JSON.stringify({ model: model, messages: omsgs, temperature: 0.2 }) })
      .then(function (j) { var c = j.choices && j.choices[0]; if (!c) throw new Error('Boş yanıt'); return c.message.content || ''; });
  }

  function listModels(cfg) {
    var p = PROVIDERS[cfg.provider], key = (cfg.keys || {})[cfg.provider] || '';
    if (p.needsKey && !key && cfg.provider !== 'openrouter') return Promise.reject(new Error('Önce API anahtarını gir.'));
    if (cfg.provider === 'gemini') return fetchJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key), { method: 'GET' })
      .then(function (j) { return (j.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; }).map(function (m) { return m.name.replace(/^models\//, ''); }); });
    if (cfg.provider === 'anthropic') return fetchJson('https://api.anthropic.com/v1/models?limit=100', { method: 'GET', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } })
      .then(function (j) { return (j.data || []).map(function (m) { return m.id; }); });
    if (cfg.provider === 'ollama') return fetchJson((cfg.ollamaUrl || p.baseUrl).replace(/\/$/, '') + '/api/tags', { method: 'GET' })
      .then(function (j) { return (j.models || []).map(function (m) { return m.name; }); });
    var h = key ? { 'Authorization': 'Bearer ' + key } : {};
    return fetchJson(OPENAI_COMPAT[cfg.provider] + '/models', { method: 'GET', headers: h }).then(function (j) {
      var ids = (j.data || []).map(function (m) { return m.id; });
      if (cfg.provider === 'openrouter') ids.sort(function (a, b) { return (/:free$/.test(b) ? 1 : 0) - (/:free$/.test(a) ? 1 : 0) || a.localeCompare(b); });
      return ids;
    });
  }

  root.AI = { PROVIDERS: PROVIDERS, chat: chat, listModels: listModels };
})(this);
