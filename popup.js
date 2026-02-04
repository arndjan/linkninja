// Default presets
const DEFAULT_PRESETS = {
  'nrc.nl': '/nieuws/',
  'volkskrant.nl': '/nieuws/',
  'nos.nl': '/artikel/',
  'nu.nl': '/-/',
  'ad.nl': '/nieuws/',
  'telegraaf.nl': '/nieuws/',
  'trouw.nl': '/nieuws/',
  'parool.nl': '/nieuws/',
  'fd.nl': '/nieuws/',
  'theguardian.com': '/\\/\\d{4}\\//',
  'nytimes.com': '/\\/\\d{4}\\//',
  'bbc.com': '/news/',
  'bbc.co.uk': '/news/',
  'medium.com': '/@/',
  'substack.com': '/p/',
};

let presets = {};
let currentHostname = '';

// Load presets from storage
async function loadPresets() {
  const result = await chrome.storage.sync.get('presets');
  presets = result.presets || { ...DEFAULT_PRESETS };
  return presets;
}

// Save presets to storage
async function savePresets() {
  await chrome.storage.sync.set({ presets });
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadPresets();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentHostname = new URL(tab.url).hostname.replace('www.', '');

  // Check for preset
  const matchedDomain = Object.keys(presets).find(domain => currentHostname.includes(domain));

  if (matchedDomain) {
    document.getElementById('filter').value = presets[matchedDomain];
    document.getElementById('presetText').textContent = `Preset: ${matchedDomain}`;
    document.getElementById('presetInfo').style.display = 'flex';
  } else {
    // Show save button for unknown sites
    document.getElementById('presetText').textContent = `No preset for ${currentHostname}`;
    document.getElementById('presetInfo').style.display = 'flex';
    document.getElementById('presetInfo').style.background = '#fff3e0';
    document.getElementById('presetInfo').style.color = '#e65100';
    document.getElementById('savePreset').style.display = 'block';
  }

  // Update filter field listener to show save button when changed
  document.getElementById('filter').addEventListener('input', () => {
    const filter = document.getElementById('filter').value.trim();
    if (filter && !presets[currentHostname]) {
      document.getElementById('savePreset').style.display = 'block';
    }
  });
});

// View switching
document.getElementById('openSettings').addEventListener('click', () => {
  document.getElementById('mainView').style.display = 'none';
  document.getElementById('settingsView').style.display = 'block';
  renderPresetList();
});

document.getElementById('closeSettings').addEventListener('click', () => {
  document.getElementById('settingsView').style.display = 'none';
  document.getElementById('mainView').style.display = 'block';
});

// Render preset list
function renderPresetList() {
  const list = document.getElementById('presetList');
  list.innerHTML = '';

  const sortedDomains = Object.keys(presets).sort();

  for (const domain of sortedDomains) {
    const item = document.createElement('div');
    item.className = 'preset-item';
    item.innerHTML = `
      <div>
        <div class="domain">${domain}</div>
        <div class="filter">${presets[domain]}</div>
      </div>
      <button class="danger" data-domain="${domain}">✕</button>
    `;
    list.appendChild(item);
  }

  // Add delete handlers
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const domain = e.target.dataset.domain;
      delete presets[domain];
      await savePresets();
      renderPresetList();
    });
  });
}

// Add preset
document.getElementById('addPreset').addEventListener('click', async () => {
  const domain = document.getElementById('newDomain').value.trim().toLowerCase();
  const filter = document.getElementById('newFilter').value.trim();

  if (!domain || !filter) {
    alert('Please fill in both domain and filter');
    return;
  }

  presets[domain] = filter;
  await savePresets();

  document.getElementById('newDomain').value = '';
  document.getElementById('newFilter').value = '';
  renderPresetList();
});

// Save preset for current site
document.getElementById('savePreset').addEventListener('click', async () => {
  const filter = document.getElementById('filter').value.trim();
  if (!filter) {
    alert('Please enter a filter first');
    return;
  }

  presets[currentHostname] = filter;
  await savePresets();

  document.getElementById('presetText').textContent = `Preset saved: ${currentHostname}`;
  document.getElementById('presetInfo').style.background = '#e8f5e9';
  document.getElementById('presetInfo').style.color = '#2e7d32';
  document.getElementById('savePreset').style.display = 'none';
});

// Reset to defaults
document.getElementById('resetDefaults').addEventListener('click', async () => {
  if (confirm('Reset all presets to defaults?')) {
    presets = { ...DEFAULT_PRESETS };
    await savePresets();
    renderPresetList();
  }
});

// Extract buttons
document.getElementById('extract').addEventListener('click', () => extractLinks(true));
document.getElementById('extractAll').addEventListener('click', () => extractLinks(false));

async function extractLinks(useFilter) {
  const status = document.getElementById('status');
  const format = document.getElementById('format').value;
  const filterInput = document.getElementById('filter').value.trim();

  status.textContent = 'Extracting...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractFromPage,
      args: [useFilter ? filterInput : null]
    });

    const links = result.result;

    if (links.length === 0) {
      status.textContent = 'No links found matching filter.';
      return;
    }

    // Format content
    const hostname = new URL(tab.url).hostname.replace('www.', '');
    const date = new Date().toISOString().split('T')[0];

    let content, ext;

    if (format === 'urls') {
      ext = 'txt';
      content = links.map(l => l.url).join('\n');
    } else if (format === 'markdown') {
      ext = 'md';
      content = `# Links from ${hostname}\n\n`;
      content += links.map(l => `- [${l.title}](${l.url})`).join('\n');
    } else if (format === 'json') {
      ext = 'json';
      content = JSON.stringify({
        source: tab.url,
        extracted: new Date().toISOString(),
        filter: useFilter ? filterInput : null,
        count: links.length,
        links: links
      }, null, 2);
    }

    const filename = `${hostname}-links-${date}.${ext}`;

    // Download
    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
    await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    });

    status.textContent = `Done! ${links.length} links saved.`;

  } catch (err) {
    status.textContent = 'Error: ' + err.message;
    console.error(err);
  }
}

function extractFromPage(filterPattern) {
  // Skip these URL patterns
  const skipPatterns = [
    /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|mp4|mp3)(\?|$)/i,
    /^javascript:/,
    /^mailto:/,
    /^tel:/,
  ];

  // Parse filter: /regex/ or plain prefix
  let filterFn = null;
  if (filterPattern) {
    if (filterPattern.startsWith('/') && filterPattern.lastIndexOf('/') > 0) {
      // It's a regex: /pattern/flags
      const lastSlash = filterPattern.lastIndexOf('/');
      const pattern = filterPattern.slice(1, lastSlash);
      const flags = filterPattern.slice(lastSlash + 1) || 'i';
      try {
        const regex = new RegExp(pattern, flags);
        filterFn = url => regex.test(url);
      } catch (e) {
        console.error('Invalid regex:', e);
      }
    } else {
      // Plain prefix/substring match
      filterFn = url => url.includes(filterPattern);
    }
  }

  const links = Array.from(document.querySelectorAll('a[href]'));
  const seen = new Set();
  const extracted = [];

  for (const link of links) {
    let href = link.href;

    // Skip unwanted URLs
    if (skipPatterns.some(p => p.test(href))) continue;

    // Remove anchor fragments for deduplication
    const baseUrl = href.split('#')[0];
    if (seen.has(baseUrl)) continue;
    seen.add(baseUrl);

    // Skip current page
    if (baseUrl === window.location.href.split('#')[0]) continue;

    // Get clean title
    let title = link.textContent.trim().replace(/\s+/g, ' ');
    if (!title || title.startsWith('<')) continue;
    title = title.substring(0, 200);

    // Apply filter if specified
    if (filterFn && !filterFn(baseUrl)) continue;

    extracted.push({
      title: title,
      url: baseUrl
    });
  }

  return extracted;
}
