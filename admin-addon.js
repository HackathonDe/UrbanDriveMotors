/* Urban Drive Motors admin add-on.
   Paste inside a new <script> ... </script> block placed AFTER your existing
   main <script> block and before </body>. Nothing in your file needs to change. */
(function () {
  'use strict';

  /* 1. Bulk delete */
  const bd = document.createElement('button');
  bd.type = 'button'; bd.className = 'btn small'; bd.textContent = 'Delete selected';
  $('bulk').appendChild(bd);
  bd.addEventListener('click', async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const targets = vehicles.filter(v => selected.has(v.id));
    const ok = await askConfirm({
      title: 'Delete ' + ids.length + ' vehicle' + (ids.length === 1 ? '' : 's') + '?',
      text: 'This cannot be undone. Their photos are removed too.',
      yes: 'Yes, delete', no: 'Keep them'
    });
    if (!ok) return;
    showLoader('Deleting...');
    const { error } = await sb.from('vehicles').delete().in('id', ids);
    if (!error) await removeImages(targets.flatMap(v => v.image_urls || []));
    hideLoader();
    if (error) { toast(friendly(error), true); return; }
    toast(ids.length + ' deleted.'); selected.clear(); reload();
  });

  /* 2. Unsaved changes warning + Ctrl/Cmd+S to save */
  let dirty = false;
  const markDirty = () => { dirty = true; };
  ['input', 'change'].forEach(n => $('vform').addEventListener(n, markDirty));
  ['featPrev', 'galGrid', 'featDrop', 'galDrop'].forEach(id => $(id).addEventListener('click', markDirty));
  $('featDrop').addEventListener('drop', markDirty);
  $('galDrop').addEventListener('drop', markDirty);
  const _openForm = openForm;
  openForm = function (mode, v) { _openForm(mode, v); dirty = false; };
  window.addEventListener('hashchange', () => { dirty = false; });
  window.addEventListener('beforeunload', e => {
    if (dirty && !$('pg-form').hidden) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !$('pg-form').hidden) {
      e.preventDefault(); saveVehicle();
    }
  });

  /* 3. Stop a mis-dropped photo from navigating away from the page */
  ['dragover', 'drop'].forEach(n => window.addEventListener(n, e => {
    if (!e.target.closest || !e.target.closest('.drop')) e.preventDefault();
  }));

  /* 4. Dashboard: most viewed vehicles */
  const topPanel = document.createElement('div');
  topPanel.className = 'panel flush'; topPanel.style.marginTop = '14px';
  topPanel.innerHTML = '<div class="ph"><h2>Most viewed vehicles</h2><a href="#/inventory">Open inventory</a></div><div class="mini" id="topVeh"></div>';
  $('pg-dashboard').appendChild(topPanel);
  function renderTop() {
    const list = vehicles.filter(v => viewCount[v.id]).sort((a, b) => viewCount[b.id] - viewCount[a.id]).slice(0, 5);
    $('topVeh').innerHTML = list.length ? list.map(v => {
      const img = v.image_urls && v.image_urls[0] ? '<img src="' + esc(v.image_urls[0]) + '" alt="" loading="lazy">' : '<div class="ph0"></div>';
      const n = viewCount[v.id], u = viewerCount[v.id] || 0;
      return '<a class="it" href="#/inventory/edit/' + v.id + '">' + img + '<div class="tx"><b>' + esc(vname(v)) + '</b><span>' + n + (n === 1 ? ' view' : ' views') + ' from ' + u + (u === 1 ? ' customer' : ' customers') + '</span></div>' + badge(v.status) + '</a>';
    }).join('') : '<div class="empty">No views yet.</div>';
  }
  const _renderDashboard = renderDashboard;
  renderDashboard = function () { _renderDashboard(); renderTop(); };

  /* 5. Customers: click a row to see what they viewed */
  const _renderCustomers = renderCustomers;
  renderCustomers = function () {
    _renderCustomers();
    const rows = $('clist').querySelectorAll('.crow:not(.head)');
    filteredCustomers().forEach((c, i) => {
      if (rows[i]) { rows[i].dataset.uid = c.id; rows[i].style.cursor = 'pointer'; rows[i].title = 'Click to see the vehicles they viewed'; }
    });
  };
  $('clist').addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const row = e.target.closest('.crow[data-uid]'); if (!row) return;
    const next = row.nextElementSibling;
    if (next && next.classList.contains('cdet')) { next.remove(); return; }
    const mine = views.filter(x => x.user_id === row.dataset.uid);
    const byVeh = {};
    mine.forEach(x => {
      const v = x.vehicles || {}, k = x.vehicle_id;
      (byVeh[k] = byVeh[k] || { name: v.make ? vname(v) : 'Deleted vehicle', n: 0, last: x.created_at }).n++;
    });
    const d = document.createElement('div');
    d.className = 'row cdet'; d.style.background = 'var(--soft)'; d.style.display = 'block';
    const items = Object.values(byVeh);
    d.innerHTML = items.length
      ? items.map(o => '<div><strong>' + esc(o.name) + '</strong> <span class="sub">' + o.n + (o.n === 1 ? ' view' : ' views') + ', last ' + when(o.last) + '</span></div>').join('')
      : '<span class="sub">This customer has not opened any vehicle yet.</span>';
    row.after(d);
  });

  /* 6. Refresh button + automatic refresh every 2 minutes */
  const rb = document.createElement('button');
  rb.type = 'button'; rb.className = 'theme'; rb.setAttribute('aria-label', 'Refresh data'); rb.title = 'Refresh data';
  rb.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>';
  $('themeBtn').before(rb);
  rb.addEventListener('click', async () => {
    if (!$('pg-form').hidden && dirty) { toast('Save or leave the form before refreshing.', true); return; }
    await reload(); toast('Data refreshed.');
  });
  setInterval(() => {
    if (!appReady || document.hidden || dirty || !$('pg-form').hidden || selected.size || document.querySelector('dialog[open]')) return;
    reload();
  }, 120000);

  /* 7. Warn about a duplicate VIN before saving */
  const _save = saveVehicle;
  saveVehicle = async function (forceStatus) {
    const vin = $('f_vin').value.trim().toLowerCase();
    if (vin) {
      const myId = formMode === 'edit' && formVehicle ? formVehicle.id : null;
      const clash = Object.values(priv).find(p => p.vin && p.vin.toLowerCase() === vin && p.vehicle_id !== myId);
      if (clash && !(await askConfirm({
        title: 'Duplicate VIN',
        text: 'Another vehicle already uses this VIN. Save anyway?',
        yes: 'Save anyway', no: 'Go back'
      }))) return;
    }
    return _save(forceStatus);
  };
})();
