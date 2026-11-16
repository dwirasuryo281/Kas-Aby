/* =====================================================
 * KAS ABY · APP
 * Vanilla JS, tanpa build step. Data dari Apps Script.
 * ===================================================== */
(() => {
  'use strict';

  const CFG = window.KAS_CONFIG || {};
  const API = CFG.API_URL || '';
  const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const COLORS = ['#7c5cff', '#3b82f6', '#14b8a6', '#f59e0b', '#f43f5e', '#06b6d4', '#a855f7', '#84cc16', '#64748b'];
  const PERIODS = [['hari', 'Hari ini'], ['minggu', 'Minggu ini'], ['bulan', 'Bulan ini'], ['tahun', 'Tahun ini'], ['custom', 'Custom']];
  const TITLES = { beranda: 'Beranda', riwayat: 'Riwayat', grafik: 'Grafik', pengaturan: 'Pengaturan' };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- storage aman ---------- */
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem('kas_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kas_' + k, JSON.stringify(v)); } catch (e) { /* abaikan */ } },
    del(k) { try { localStorage.removeItem('kas_' + k); } catch (e) { /* abaikan */ } },
  };

  /* ---------- state ---------- */
  const S = {
    data: store.get('cache'),
    role: store.get('role'),
    period: store.get('period', { key: 'bulan' }),
    hist: { q: '', jenis: '', kat: '', from: '', to: '' },
    page: 'beranda',
    charts: {},
    form: { mode: 'add', jenis: 'Masuk', nama: '', jumlah: 1, tx: null },
    katTab: 'Masuk',
    loading: false,
  };

  /* ---------- util ---------- */
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d || 1); };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const monthKey = s => (s ? String(s).slice(0, 7) : '');
  const curMonthKey = () => iso(today()).slice(0, 7);
  const fmtTgl = (s, bulanSaja) => { const d = parse(s); if (!d) return 'Tanpa tanggal'; return bulanSaja ? `${BLN[d.getMonth()]} ${d.getFullYear()}` : `${d.getDate()} ${BLN[d.getMonth()]} ${d.getFullYear()}`; };
  const fmtBln = s => { const d = parse(s); return d ? `${BLN[d.getMonth()]} ${d.getFullYear()}` : '-'; };
  const fmtBulanPanjang = s => { const d = parse(s); return d ? `${BULAN[d.getMonth()]} ${d.getFullYear()}` : '-'; };
  const rp = n => (n < 0 ? '-' : '') + 'Rp ' + Math.abs(Math.round(n || 0)).toLocaleString('id-ID');
  const rpShort = n => {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' M';
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' jt';
    if (a >= 1e3) return Math.round(n / 1e3) + ' rb';
    return String(n);
  };
  const digits = s => String(s || '').replace(/\D/g, '');
  const dots = s => { const d = digits(s).replace(/^0+(?=\d)/, ''); return d ? Number(d).toLocaleString('id-ID') : ''; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const effDate = t => t.tanggal || t.bulanUntuk;
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const isOwner = () => S.role === 'owner';
  const initial = s => (String(s || '?').trim()[0] || '?').toUpperCase();

  /* ---------- API ---------- */
  class NetErr extends Error { constructor() { super('Tidak ada koneksi internet.'); this.net = true; } }
  class ApiErr extends Error { constructor(m, code) { super(m); this.code = code; } }

  async function api(action, body = {}) {
    if (!API || API.indexOf('TEMPEL') === 0) throw new ApiErr('URL API belum diisi di config.js.', 'CONFIG');
    let res;
    try {
      res = await fetch(API, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action, t: store.get('token'), k: store.get('viewKey') }, body)),
      });
    } catch (e) { throw new NetErr(); }
    let j;
    try { j = await res.json(); } catch (e) { throw new ApiErr('Server tidak merespons dengan benar. Cek URL & deploy Apps Script.'); }
    if (!j.ok) throw new ApiErr(j.error || 'Terjadi kesalahan.', j.code);
    return j;
  }

  /* ---------- outbox offline ---------- */
  const outbox = {
    list() { return store.get('outbox', []); },
    push(x) { const l = this.list(); l.push(x); store.set('outbox', l); },
    remove(cid) { store.set('outbox', this.list().filter(x => x.cid !== cid)); },
  };

  async function flushOutbox() {
    const items = outbox.list();
    if (!items.length || !isOwner()) return renderOutbox();
    let sent = 0;
    for (const it of items) {
      try { await api('add', { item: it.item, cid: it.cid }); outbox.remove(it.cid); sent++; }
      catch (e) {
        if (e.net) break;
        outbox.remove(it.cid);
        toast(`Gagal kirim ${it.item.nama}: ${e.message}`, 'err', 5000);
      }
    }
    renderOutbox();
    if (sent) { toast(`${sent} transaksi tertunda berhasil dikirim`, 'ok'); load(true); }
  }

  function pendingTx() {
    const out = [];
    outbox.list().forEach(o => {
      const it = o.item, n = it.jumlahBulan || 1, b = parse(it.bulanUntuk);
      for (let i = 0; i < n; i++) {
        const bu = new Date(b.getFullYear(), b.getMonth() + i, 1);
        out.push({ row: null, pending: true, tanggal: it.tanggal, bulanUntuk: iso(bu), jenis: it.jenis, nama: it.nama, nominal: Number(it.nominal), ket: it.ket || '' });
      }
    });
    return out;
  }

  const allTx = () => ((S.data && S.data.transaksi) || []).concat(pendingTx());

  /* ---------- load data ---------- */
  async function load(silent) {
    if (S.loading) return;
    S.loading = true;
    $('#btn-refresh').classList.add('spin');
    try {
      const j = await api('data');
      S.role = j.role;
      S.data = { saldoAwal: j.saldoAwal, donatur: j.donatur, pos: j.pos, transaksi: j.transaksi, viewKey: j.viewKey || null, serverTime: j.serverTime };
      store.set('cache', S.data);
      store.set('role', S.role);
      $('#offline-bar').classList.add('hidden');
      render();
      flushOutbox();
    } catch (e) {
      if (e.net) {
        $('#offline-bar').classList.remove('hidden');
        if (!silent) toast('Offline. Menampilkan data terakhir.', 'info');
      } else if (e.code === 'AUTH') {
        if (store.get('token')) {
          store.del('token');
          S.role = store.get('viewKey') ? 'view' : null;
          toast('Sesi pemilik berakhir. Masuk lagi dengan PIN.', 'info', 4000);
          S.loading = false;
          return load(true);
        }
        S.role = null; S.data = null; store.del('cache'); store.del('role');
        toast('Link tidak valid atau sudah diganti. Minta link baru ke pemilik.', 'err', 5000);
      } else {
        toast(e.message, 'err', 5000);
      }
      render();
    } finally {
      S.loading = false;
      $('#btn-refresh').classList.remove('spin');
    }
  }

  /* ---------- periode ---------- */
  function range(p) {
    const t = today();
    if (p.key === 'hari') return { from: t, to: t, prevLabel: 'kemarin' };
    if (p.key === 'minggu') {
      const f = new Date(t); f.setDate(t.getDate() - ((t.getDay() + 6) % 7));
      const e = new Date(f); e.setDate(f.getDate() + 6);
      return { from: f, to: e, prevLabel: 'minggu lalu' };
    }
    if (p.key === 'tahun') return { from: new Date(t.getFullYear(), 0, 1), to: new Date(t.getFullYear(), 11, 31), prevLabel: 'tahun lalu' };
    if (p.key === 'custom' && p.from && p.to) {
      const f = parse(p.from), e = parse(p.to);
      return f <= e ? { from: f, to: e, prevLabel: 'periode sebelumnya' } : { from: e, to: f, prevLabel: 'periode sebelumnya' };
    }
    return { from: new Date(t.getFullYear(), t.getMonth(), 1), to: new Date(t.getFullYear(), t.getMonth() + 1, 0), prevLabel: 'bulan lalu' };
  }

  function prevRange(r, key) {
    if (key === 'bulan') {
      return { from: new Date(r.from.getFullYear(), r.from.getMonth() - 1, 1), to: new Date(r.from.getFullYear(), r.from.getMonth(), 0) };
    }
    if (key === 'tahun') return { from: new Date(r.from.getFullYear() - 1, 0, 1), to: new Date(r.from.getFullYear() - 1, 11, 31) };
    const days = Math.round((r.to - r.from) / 864e5) + 1;
    const e = new Date(r.from); e.setDate(e.getDate() - 1);
    const f = new Date(e); f.setDate(e.getDate() - days + 1);
    return { from: f, to: e };
  }

  const inRange = (t, r) => { const d = parse(effDate(t)); return !!d && d >= r.from && d <= r.to; };
  function sums(list) {
    let i = 0, o = 0;
    list.forEach(t => { if (t.jenis === 'Masuk') i += t.nominal; else if (t.jenis === 'Keluar') o += t.nominal; });
    return { i, o, net: i - o };
  }
  const sortTx = list => list.slice().sort((a, b) => (effDate(b) || '').localeCompare(effDate(a) || '') || (b.row || 1e9) - (a.row || 1e9));

  function renderPeriodChips() {
    $$('.period-chips').forEach(box => {
      box.innerHTML = PERIODS.map(([k, l]) => `<button class="chip-p ${S.period.key === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('');
    });
    ['beranda', 'grafik'].forEach(sc => {
      const el = $('#custom-range-' + sc);
      if (S.period.key !== 'custom') { el.classList.add('hidden'); return; }
      const r = range(S.period);
      el.classList.remove('hidden');
      el.innerHTML = `<input type="date" data-cr="from" value="${S.period.from || iso(r.from)}" aria-label="Dari"><input type="date" data-cr="to" value="${S.period.to || iso(r.to)}" aria-label="Sampai">`;
    });
  }

  /* ---------- render utama ---------- */
  function render() {
    renderHeader();
    renderPeriodChips();
    renderBeranda();
    renderRiwayat();
    if (S.page === 'grafik') renderGrafik();
    renderPengaturan();
    renderOutbox();
  }

  function renderHeader() {
    const b = $('#role-badge');
    b.className = 'role' + (isOwner() ? ' owner' : '');
    b.textContent = isOwner() ? 'Pemilik · bisa input' : S.role === 'view' ? 'Mode lihat saja' : 'Belum terhubung';
    $('#fab').style.visibility = isOwner() ? 'visible' : 'hidden';
  }

  function renderOutbox() {
    const n = outbox.list().length;
    const bar = $('#outbox-bar');
    if (!n) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.innerHTML = `<span>${n} input belum terkirim ke spreadsheet</span><button id="btn-flush">Kirim sekarang</button>`;
  }

  /* ----- beranda ----- */
  function renderBeranda() {
    const d = S.data;
    if (!d) {
      $('#saldo-utama').textContent = 'Rp 0';
      $('#saldo-sub').textContent = S.role ? 'Memuat data…' : 'Buka lewat link dari pemilik, atau masuk dengan PIN di menu Atur.';
      $('#recent-list').innerHTML = S.role ? skel(3) : emptyHTML('Belum terhubung', 'Aplikasi ini perlu link dari pemilik atau PIN.');
      ['#st-in', '#st-out', '#st-net'].forEach(s => { $(s).textContent = '-'; });
      $('#infaq-text').textContent = ''; $('#infaq-pending').innerHTML = ''; $('#insight-beranda').innerHTML = '';
      return;
    }
    $('#saldo-utama').classList.remove('skeleton-text');
    const tx = allTx();
    const cm = curMonthKey();
    let saldo = d.saldoAwal, titip = 0;
    tx.forEach(t => {
      const v = t.jenis === 'Masuk' ? t.nominal : -t.nominal;
      if (monthKey(t.bulanUntuk) <= cm) saldo += v; else if (t.jenis === 'Masuk') titip += t.nominal;
    });
    $('#saldo-utama').textContent = rp(saldo);
    $('#saldo-sub').textContent = `s.d. ${fmtBulanPanjang(cm + '-01')} · sama dengan Laporan Bulanan` + (titip ? ` · titipan bulan depan ${rp(titip)}` : '');

    const r = range(S.period), pr = prevRange(r, S.period.key);
    const cur = sums(tx.filter(t => inRange(t, r)));
    const prev = sums(tx.filter(t => inRange(t, pr)));
    $('#st-in').textContent = rp(cur.i);
    $('#st-out').textContent = rp(cur.o);
    const net = $('#st-net'); net.textContent = rp(cur.net); net.className = 'stat-amount ' + (cur.net >= 0 ? 'pos' : 'neg');
    setDelta('#st-in-d', cur.i, prev.i, r.prevLabel, true);
    setDelta('#st-out-d', cur.o, prev.o, r.prevLabel, false);

    // infaq bulan ini
    const donors = d.donatur || [];
    let lunas = 0, terkumpul = 0, target = 0;
    const pending = [];
    donors.forEach(dn => {
      const paid = tx.filter(t => t.jenis === 'Masuk' && t.nama === dn.nama && monthKey(t.bulanUntuk) === cm).reduce((a, t) => a + t.nominal, 0);
      terkumpul += paid; target += dn.komitmen;
      const ok = dn.komitmen ? paid >= dn.komitmen : paid > 0;
      if (ok) lunas++; else pending.push({ dn, sisa: Math.max(0, dn.komitmen - paid), paid });
    });
    $('#infaq-count').textContent = `${lunas}/${donors.length} lunas`;
    $('#infaq-bar').style.width = (target ? Math.min(100, terkumpul / target * 100) : 0) + '%';
    $('#infaq-text').textContent = `${rp(terkumpul)} dari komitmen ${rp(target)} untuk ${fmtBulanPanjang(cm + '-01')}`;
    $('#infaq-pending').innerHTML = pending.length
      ? pending.map(p => `<button class="pending-chip ${isOwner() ? 'tap' : ''}" data-donor="${esc(p.dn.nama)}" data-sisa="${p.sisa}">${esc(p.dn.nama)} <small>${p.paid ? 'kurang ' + rp(p.sisa) : 'belum masuk'}</small></button>`).join('')
      : '<p class="muted small">Semua donatur sudah masuk bulan ini. Alhamdulillah.</p>';

    $('#insight-beranda').innerHTML = insightsHTML(tx, r, pr, false);

    const recent = sortTx(tx).slice(0, 6);
    $('#recent-list').innerHTML = recent.length ? recent.map(txHTML).join('') : emptyHTML('Belum ada transaksi', 'Tekan tombol + untuk mencatat yang pertama.');
  }

  function setDelta(sel, cur, prev, label, upGood) {
    const el = $(sel);
    if (!prev && !cur) { el.textContent = ''; el.className = 'delta'; return; }
    if (!prev) { el.textContent = `belum ada data ${label}`; el.className = 'delta'; return; }
    const pct = Math.round((cur - prev) / prev * 100);
    const up = pct >= 0;
    el.textContent = `${up ? '▲' : '▼'} ${Math.abs(pct)}% vs ${label}`;
    el.className = 'delta ' + ((up === upGood) ? 'up' : 'down');
  }

  function insightsHTML(tx, r, pr, full) {
    const inR = tx.filter(t => inRange(t, r));
    const keluar = inR.filter(t => t.jenis === 'Keluar');
    const tot = keluar.reduce((a, t) => a + t.nominal, 0);
    const items = [];
    const ic = p => `<div class="ic"><svg viewBox="0 0 24 24">${p}</svg></div>`;

    if (keluar.length) {
      const by = {};
      keluar.forEach(t => { by[t.nama] = (by[t.nama] || 0) + t.nominal; });
      const [top, v] = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
      items.push(`<div class="insight">${ic('<path d="M12 3v18M5 10l7-7 7 7"/>')}<p>Pengeluaran terbesar: <b>${esc(top)}</b> ${rp(v)} (${Math.round(v / tot * 100)}% dari total).</p></div>`);
      const end = r.to > today() ? today() : r.to;
      const days = Math.max(1, Math.round((end - r.from) / 864e5) + 1);
      items.push(`<div class="insight">${ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}<p>Rata-rata pengeluaran harian <b>${rp(tot / days)}</b> selama ${days} hari.</p></div>`);
    } else {
      items.push(`<div class="insight">${ic('<path d="M5 12l4 4L19 6"/>')}<p>Belum ada pengeluaran di periode ini.</p></div>`);
    }
    const po = tx.filter(t => inRange(t, pr) && t.jenis === 'Keluar').reduce((a, t) => a + t.nominal, 0);
    if (po) {
      const pct = Math.round((tot - po) / po * 100);
      items.push(`<div class="insight">${ic('<path d="M4 17l6-6 4 4 6-6"/>')}<p>Pengeluaran <b>${pct >= 0 ? 'naik' : 'turun'} ${Math.abs(pct)}%</b> dibanding ${r.prevLabel} (${rp(po)}).</p></div>`);
    }
    if (full && S.data) {
      const kom = (S.data.donatur || []).reduce((a, x) => a + x.komitmen, 0);
      const rut = (S.data.pos || []).reduce((a, x) => a + x.rutin, 0);
      if (kom && rut) {
        const sel = kom - rut;
        items.push(`<div class="insight">${ic('<path d="M3 12h18M12 3v18"/>')}<p>Komitmen donatur ${rp(kom)}/bulan vs pengeluaran rutin ${rp(rut)}/bulan: <b class="${sel >= 0 ? 'pos' : 'neg'}">${sel >= 0 ? 'surplus' : 'kurang'} ${rp(Math.abs(sel))}</b> tiap bulan.</p></div>`);
      }
    }
    return items.join('');
  }

  function txHTML(t) {
    const io = t.jenis === 'Masuk' ? 'in' : 'out';
    const sub = [fmtTgl(t.tanggal, t.tanggalBulanSaja)];
    if (t.bulanUntuk && monthKey(t.bulanUntuk) !== monthKey(t.tanggal)) sub.push('untuk ' + fmtBln(t.bulanUntuk));
    if (t.ket) sub.push(t.ket);
    const key = t.pending ? '' : `data-row="${t.row}"`;
    return `<button class="tx ${t.pending ? 'pending' : ''}" ${key}>
      <div class="tx-ic ${io}">${esc(initial(t.nama))}</div>
      <div class="tx-main"><b>${esc(t.nama)}${t.pending ? '<span class="badge-pending">menunggu</span>' : ''}</b><small>${esc(sub.join(' · '))}</small></div>
      <div class="tx-amt ${io}">${io === 'in' ? '+' : '-'}${rp(t.nominal).replace('Rp ', 'Rp')}</div>
    </button>`;
  }

  const emptyHTML = (t, s) => `<div class="empty"><div class="em-ic"><svg viewBox="0 0 24 24"><path d="M4 7h16v12H4zM4 7l2-3h12l2 3M9 12h6"/></svg></div><b>${t}</b><span class="small">${s}</span></div>`;
  const skel = n => Array.from({ length: n }, () => '<div class="skel"></div>').join('');

  /* ----- riwayat ----- */
  function renderRiwayat() {
    const d = S.data;
    const sel = $('#h-kat');
    const names = d ? (S.hist.jenis === 'Keluar' ? d.pos : S.hist.jenis === 'Masuk' ? d.donatur : d.donatur.concat(d.pos)).map(x => x.nama) : [];
    const used = Array.from(new Set(allTx().map(t => t.nama)));
    const opts = Array.from(new Set(names.concat(used.filter(n => !S.hist.jenis || allTx().some(t => t.nama === n && t.jenis === S.hist.jenis)))));
    if (S.hist.kat && opts.indexOf(S.hist.kat) === -1) S.hist.kat = '';
    sel.innerHTML = '<option value="">Semua kategori</option>' + opts.map(n => `<option ${n === S.hist.kat ? 'selected' : ''}>${esc(n)}</option>`).join('');

    if (!d) { $('#history-list').innerHTML = S.role ? skel(6) : emptyHTML('Belum terhubung', 'Buka lewat link dari pemilik.'); $('#h-summary').textContent = ''; return; }
    const q = S.hist.q.trim().toLowerCase();
    const f = S.hist.from ? parse(S.hist.from) : null, e = S.hist.to ? parse(S.hist.to) : null;
    const list = sortTx(allTx().filter(t => {
      if (S.hist.jenis && t.jenis !== S.hist.jenis) return false;
      if (S.hist.kat && t.nama !== S.hist.kat) return false;
      const dt = parse(effDate(t));
      if (f && (!dt || dt < f)) return false;
      if (e && (!dt || dt > e)) return false;
      if (q && (t.nama + ' ' + t.ket + ' ' + rp(t.nominal)).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }));
    const s = sums(list);
    $('#h-summary').textContent = list.length ? `${list.length} transaksi · masuk ${rp(s.i)} · keluar ${rp(s.o)}` : '';
    if (!list.length) { $('#history-list').innerHTML = emptyHTML('Tidak ada yang cocok', 'Coba ubah kata kunci atau filter.'); return; }
    let html = '', last = '';
    list.forEach(t => {
      const mk = monthKey(effDate(t)) || 'x';
      if (mk !== last) {
        const g = sums(list.filter(x => (monthKey(effDate(x)) || 'x') === mk));
        html += `<div class="group-head"><span>${mk === 'x' ? 'Tanpa tanggal' : fmtBulanPanjang(mk + '-01')}</span><span class="${g.net >= 0 ? 'pos' : 'neg'}">${rp(g.net)}</span></div>`;
        last = mk;
      }
      html += txHTML(t);
    });
    $('#history-list').innerHTML = html;
  }

  /* ----- grafik ----- */
  function renderGrafik() {
    const d = S.data;
    $('#insight-grafik').innerHTML = d ? insightsHTML(allTx(), range(S.period), prevRange(range(S.period), S.period.key), true) : '';
    if (!d) return;
    if (!window.Chart) {
      ['ch-kategori', 'ch-tren', 'ch-banding'].forEach(id => { $('#' + id).parentElement.innerHTML = emptyHTML('Grafik belum termuat', 'Butuh koneksi internet sekali untuk memuat grafik.') + `<canvas id="${id}" hidden></canvas>`; });
      return;
    }
    Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
    Chart.defaults.color = '#6b7290';
    const tx = allTx(), r = range(S.period);
    const inR = tx.filter(t => inRange(t, r));

    // 1. donut kategori
    const by = {};
    inR.filter(t => t.jenis === 'Keluar').forEach(t => { by[t.nama] = (by[t.nama] || 0) + t.nominal; });
    let ent = Object.entries(by).sort((a, b) => b[1] - a[1]);
    if (ent.length > 8) { const rest = ent.slice(7).reduce((a, x) => a + x[1], 0); ent = ent.slice(0, 7).concat([['Lainnya', rest]]); }
    const tot = ent.reduce((a, x) => a + x[1], 0);
    drawChart('kategori', 'ch-kategori', ent.length ? {
      type: 'doughnut',
      data: { labels: ent.map(x => x[0]), datasets: [{ data: ent.map(x => x[1]), backgroundColor: COLORS, borderWidth: 3, borderColor: '#fff', hoverOffset: 6 }] },
      options: { cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + rp(c.raw) } } } },
    } : null, 'Belum ada pengeluaran di periode ini.');
    $('#kategori-legend').innerHTML = ent.map((x, i) => `<div class="legend-row"><i style="background:${COLORS[i % COLORS.length]}"></i><span>${esc(x[0])}</span><b>${rp(x[1])}</b><small class="muted">&nbsp;${Math.round(x[1] / tot * 100)}%</small></div>`).join('');

    // 2. tren
    const span = Math.round((r.to - r.from) / 864e5) + 1;
    const daily = span <= 62;
    $('#tren-title').textContent = daily ? 'Tren pengeluaran harian' : 'Tren pengeluaran bulanan';
    const labels = [], vals = [];
    if (daily) {
      for (let i = 0; i < span; i++) {
        const dt = new Date(r.from); dt.setDate(r.from.getDate() + i);
        const k = iso(dt);
        labels.push(span <= 7 ? ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'][(dt.getDay() + 6) % 7] : String(dt.getDate()));
        vals.push(inR.filter(t => t.jenis === 'Keluar' && effDate(t) === k).reduce((a, t) => a + t.nominal, 0));
      }
    } else {
      let m = new Date(r.from.getFullYear(), r.from.getMonth(), 1);
      while (m <= r.to) {
        const k = iso(m).slice(0, 7);
        labels.push(BLN[m.getMonth()] + (r.from.getFullYear() !== r.to.getFullYear() ? ' ' + String(m.getFullYear()).slice(2) : ''));
        vals.push(inR.filter(t => t.jenis === 'Keluar' && monthKey(effDate(t)) === k).reduce((a, t) => a + t.nominal, 0));
        m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      }
    }
    drawChart('tren', 'ch-tren', vals.some(v => v) ? {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Pengeluaran', data: vals, backgroundColor: ctx => grad(ctx, '#7c5cff', '#3b82f6'), borderRadius: 8, maxBarThickness: 26 }] },
      options: baseOpts(false),
    } : null, 'Belum ada pengeluaran di periode ini.');

    // 3. banding 6 bulan
    const L = [], I = [], O = [];
    const t0 = today();
    for (let i = 5; i >= 0; i--) {
      const m = new Date(t0.getFullYear(), t0.getMonth() - i, 1);
      const k = iso(m).slice(0, 7);
      L.push(BLN[m.getMonth()]);
      const mt = tx.filter(t => monthKey(effDate(t)) === k);
      I.push(mt.filter(t => t.jenis === 'Masuk').reduce((a, t) => a + t.nominal, 0));
      O.push(mt.filter(t => t.jenis === 'Keluar').reduce((a, t) => a + t.nominal, 0));
    }
    drawChart('banding', 'ch-banding', {
      type: 'bar',
      data: { labels: L, datasets: [
        { label: 'Pemasukan', data: I, backgroundColor: '#14b8a6', borderRadius: 7, maxBarThickness: 18 },
        { label: 'Pengeluaran', data: O, backgroundColor: '#a78bfa', borderRadius: 7, maxBarThickness: 18 },
      ] },
      options: baseOpts(true),
    });
  }

  function grad(ctx, a, b) {
    const { chart } = ctx; const { ctx: c, chartArea } = chart;
    if (!chartArea) return a;
    const g = c.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    g.addColorStop(0, b); g.addColorStop(1, a); return g;
  }

  function baseOpts(legend) {
    return {
      maintainAspectRatio: false, responsive: true,
      plugins: { legend: { display: legend, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } }, tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + rp(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(20,30,70,.06)' }, border: { display: false }, ticks: { callback: v => rpShort(v), font: { size: 11 }, maxTicksLimit: 5 } },
      },
    };
  }

  function drawChart(key, id, cfg, emptyMsg) {
    if (S.charts[key]) { S.charts[key].destroy(); delete S.charts[key]; }
    let cv = $('#' + id);
    const box = cv.parentElement;
    const em = box.querySelector('.empty');
    if (em) em.remove();
    if (!cfg) { cv.hidden = true; box.insertAdjacentHTML('afterbegin', emptyHTML('Kosong', emptyMsg)); return; }
    cv.hidden = false;
    S.charts[key] = new Chart(cv, cfg);
  }

  /* ----- pengaturan ----- */
  function renderPengaturan() {
    $('#set-login').classList.toggle('hidden', isOwner());
    $('#set-owner').classList.toggle('hidden', !isOwner());
    if (isOwner() && S.data) {
      $('#share-link').textContent = S.data.viewKey ? shareLink() : 'Jalankan aturPin() di Apps Script dulu.';
      const list = S.katTab === 'Masuk' ? S.data.donatur : S.data.pos;
      $('#kat-list').innerHTML = list.map(x => `<span>${esc(x.nama)}<small>${(x.komitmen || x.rutin) ? rpShort(x.komitmen || x.rutin) : ''}</small></span>`).join('') || '<p class="muted small">Belum ada.</p>';
      $('#kat-nominal').placeholder = S.katTab === 'Masuk' ? 'Komitmen per bulan (opsional)' : 'Nominal rutin per bulan (opsional)';
    }
    const st = S.data && S.data.serverTime ? new Date(S.data.serverTime) : null;
    $('#about-sync').textContent = st ? `Terakhir sinkron: ${st.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}` : '';
  }
  const shareLink = () => location.origin + location.pathname.replace(/index\.html$/, '') + '?k=' + encodeURIComponent(S.data.viewKey);

  /* ---------- navigasi ---------- */
  function go(page) {
    if (!TITLES[page]) return;
    S.page = page;
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
    $$('.bottom-nav [data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === page));
    $('#page-title').textContent = TITLES[page];
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (page === 'grafik') renderGrafik();
  }

  /* ---------- bottom sheet ---------- */
  let openSheetId = null;
  function openSheet(id) {
    openSheetId = id;
    const el = $('#' + id);
    el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    try { history.pushState({ sheet: id }, ''); } catch (e) { /* abaikan */ }
  }
  function closeSheet(fromPop) {
    if (!openSheetId) return;
    const el = $('#' + openSheetId);
    el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
    openSheetId = null;
    document.body.style.overflow = '';
    if (!fromPop) { try { history.back(); } catch (e) { /* abaikan */ } }
  }
  window.addEventListener('popstate', () => { if (openSheetId) closeSheet(true); });

  /* ---------- form transaksi ---------- */
  function openForm(opts = {}) {
    if (!isOwner()) { toast('Mode lihat saja. Masuk dengan PIN di menu Atur untuk input.', 'info', 3500); return; }
    if (!S.data) { toast('Data belum termuat.', 'err'); return; }
    const F = S.form;
    F.mode = opts.tx ? 'edit' : 'add';
    F.tx = opts.tx || null;
    const t = opts.tx || {};
    F.jenis = t.jenis || opts.jenis || 'Masuk';
    F.nama = t.nama || opts.nama || '';
    F.jumlah = 1;
    $('#form-title').textContent = F.mode === 'edit' ? 'Edit transaksi' : 'Tambah transaksi';
    $('#f-nominal').value = t.nominal ? dots(t.nominal) : (opts.nominal ? dots(opts.nominal) : '');
    $('#f-tanggal').value = t.tanggal || iso(today());
    $('#f-bulan').value = (t.bulanUntuk || iso(today())).slice(0, 7);
    $('#f-ket').value = t.ket || '';
    $('#f-delete').classList.toggle('hidden', F.mode !== 'edit');
    $('#f-kat-new').classList.add('hidden');
    $$('.err').forEach(e => { e.textContent = ''; });
    setSaving(false);
    syncForm();
    openSheet('sheet-form');
    if (F.mode === 'add' && !F.nama) setTimeout(() => $('#f-nominal').focus(), 320);
  }

  function syncForm() {
    const F = S.form;
    $$('#f-jenis button').forEach(b => b.classList.toggle('on', b.dataset.v === F.jenis));
    $('#f-kat-label').textContent = F.jenis === 'Masuk' ? 'Donatur' : 'Pos pengeluaran';
    const list = F.jenis === 'Masuk' ? S.data.donatur : S.data.pos;
    $('#f-kat').innerHTML = list.map(x => `<button type="button" class="chip ${x.nama === F.nama ? 'on' : ''}" data-nama="${esc(x.nama)}">${esc(x.nama)}</button>`).join('') +
      '<button type="button" class="chip add" id="f-kat-add">＋ Baru</button>';
    $('#f-multi').classList.toggle('hidden', !(F.mode === 'add' && F.jenis === 'Masuk'));
    $('#f-jumlah').textContent = F.jumlah;
    const n = Number(digits($('#f-nominal').value)) || 0;
    const b = $('#f-bulan').value;
    if (b) {
      const s = parse(b + '-01'), e = new Date(s.getFullYear(), s.getMonth() + F.jumlah - 1, 1);
      $('#f-multi-info').textContent = F.jumlah > 1
        ? `${fmtBln(iso(s))} s.d. ${fmtBln(iso(e))} · total ${rp(n * F.jumlah)}`
        : 'Hanya ' + fmtBulanPanjang(iso(s));
    }
  }

  function setSaving(on) {
    const b = $('#f-save');
    b.disabled = on;
    b.innerHTML = on ? '<span class="spinner"></span>Menyimpan…' : (S.form.mode === 'edit' ? 'Simpan perubahan' : 'Simpan');
    $('#f-delete').disabled = on;
  }

  function formError(id, msg) {
    $('#err-' + id).textContent = msg;
    const el = id === 'nominal' ? $('.amount-field') : $('#f-kat');
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  async function submitForm(ev) {
    ev.preventDefault();
    const F = S.form;
    $$('.err').forEach(e => { e.textContent = ''; });
    const nominal = Number(digits($('#f-nominal').value));
    let bad = false;
    if (!nominal || nominal <= 0) { formError('nominal', 'Nominal wajib diisi dan harus lebih dari 0.'); bad = true; }
    if (!F.nama) { formError('kat', 'Pilih ' + (F.jenis === 'Masuk' ? 'donatur' : 'pos pengeluaran') + ' dulu.'); bad = true; }
    const tanggal = $('#f-tanggal').value, bulan = $('#f-bulan').value;
    if (!tanggal || !bulan) { toast('Tanggal dan bulan wajib diisi.', 'err'); bad = true; }
    if (bad) return;

    const item = { jenis: F.jenis, nominal, nama: F.nama, tanggal, bulanUntuk: bulan + '-01', ket: $('#f-ket').value.trim(), jumlahBulan: F.mode === 'add' && F.jenis === 'Masuk' ? F.jumlah : 1 };
    setSaving(true);
    try {
      if (F.mode === 'add') {
        const cid = uid();
        try {
          await api('add', { item, cid });
          toast(item.jumlahBulan > 1 ? `Tersimpan ${item.jumlahBulan} bulan ke spreadsheet` : 'Tersimpan ke spreadsheet', 'ok');
        } catch (e) {
          if (!e.net) throw e;
          outbox.push({ cid, item });
          toast('Sedang offline. Disimpan di HP, otomatis terkirim saat online.', 'info', 4000);
        }
      } else {
        const t = F.tx;
        await api('update', { row: t.row, orig: { jenis: t.jenis, nama: t.nama, nominal: t.nominal, bulanUntuk: t.bulanUntuk }, item });
        toast('Perubahan tersimpan', 'ok');
      }
      closeSheet();
      render();
      load(true);
    } catch (e) {
      toast(e.net ? 'Tidak ada koneksi. Edit butuh internet.' : e.message, 'err', 4500);
    } finally {
      setSaving(false);
    }
  }

  async function deleteTx(t) {
    const ok = await confirmBox('Hapus transaksi', `${t.nama} · ${rp(t.nominal)} · ${fmtTgl(t.tanggal, t.tanggalBulanSaja)}. Baris ini akan dihapus permanen dari spreadsheet.`);
    if (!ok) return;
    try {
      await api('delete', { row: t.row, orig: { jenis: t.jenis, nama: t.nama, nominal: t.nominal, bulanUntuk: t.bulanUntuk } });
      toast('Transaksi dihapus', 'ok');
      closeSheet();
      load(true);
    } catch (e) {
      toast(e.net ? 'Tidak ada koneksi. Hapus butuh internet.' : e.message, 'err', 4500);
    }
  }

  async function addKategori(jenis, nama, nominal) {
    nama = String(nama || '').trim();
    if (!nama) { toast('Nama tidak boleh kosong.', 'err'); return false; }
    try {
      await api('addKategori', { jenis, nama, nominal: Number(digits(nominal)) || 0 });
      const list = jenis === 'Masuk' ? S.data.donatur : S.data.pos;
      list.push(jenis === 'Masuk' ? { nama, komitmen: Number(digits(nominal)) || 0 } : { nama, rutin: Number(digits(nominal)) || 0 });
      toast(`"${nama}" ditambahkan ke sheet Daftar`, 'ok');
      return true;
    } catch (e) {
      toast(e.net ? 'Butuh internet untuk menambah kategori.' : e.message, 'err', 4500);
      return false;
    }
  }

  /* ---------- detail ---------- */
  function openDetail(t) {
    const io = t.jenis === 'Masuk' ? 'in' : 'out';
    $('#detail-body').innerHTML = `
      <p class="muted small" style="margin:6px 0 0">${t.jenis === 'Masuk' ? 'Pemasukan' : 'Pengeluaran'}</p>
      <p class="detail-amt ${io === 'in' ? 'pos' : ''}">${io === 'in' ? '+' : '-'}${rp(t.nominal)}</p>
      <h3 style="margin:0">${esc(t.nama)}</h3>
      <dl class="detail-grid">
        <dt>Tanggal</dt><dd>${fmtTgl(t.tanggal, t.tanggalBulanSaja)}</dd>
        <dt>Bulan untuk</dt><dd>${fmtBulanPanjang(t.bulanUntuk)}</dd>
        <dt>Catatan</dt><dd>${esc(t.ket) || '-'}</dd>
        ${t.row ? `<dt>Spreadsheet</dt><dd>Sheet Transaksi, baris ${t.row}</dd>` : ''}
      </dl>
      ${isOwner() && t.row ? `<div class="btn-row"><button class="btn danger-soft" id="d-del">Hapus</button><button class="btn primary grow" id="d-edit">Edit</button></div>` : `<button class="btn soft full" data-close>Tutup</button>`}`;
    openSheet('sheet-detail');
    const ed = $('#d-edit'), dl = $('#d-del');
    if (ed) ed.onclick = () => { closeSheet(); setTimeout(() => openForm({ tx: t }), 250); };
    if (dl) dl.onclick = () => deleteTx(t);
  }

  /* ---------- confirm & toast ---------- */
  function confirmBox(title, text) {
    return new Promise(res => {
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      const box = $('#confirm');
      box.classList.remove('hidden');
      const done = v => { box.classList.add('hidden'); $('#confirm-yes').onclick = $('#confirm-no').onclick = null; res(v); };
      $('#confirm-yes').onclick = () => done(true);
      $('#confirm-no').onclick = () => done(false);
    });
  }

  function toast(msg, type = 'info', ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = (type === 'ok' ? '✓ ' : type === 'err' ? '⚠ ' : '') + msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
  }

  /* ---------- event ---------- */
  function bind() {
    document.addEventListener('click', ev => {
      const t = ev.target;
      const nav = t.closest('[data-page]'); if (nav) return go(nav.dataset.page);
      const gt = t.closest('[data-goto]'); if (gt) return go(gt.dataset.goto);
      if (t.closest('[data-close]')) return closeSheet();
      const pc = t.closest('.chip-p');
      if (pc) { S.period = Object.assign({}, S.period, { key: pc.dataset.p }); store.set('period', S.period); return render(); }
      const row = t.closest('.tx[data-row]');
      if (row) { const tx = allTx().find(x => String(x.row) === row.dataset.row); if (tx) openDetail(tx); return; }
      const pd = t.closest('.pending-chip');
      if (pd && isOwner()) return openForm({ jenis: 'Masuk', nama: pd.dataset.donor, nominal: Number(pd.dataset.sisa) || '' });
      if (t.closest('#btn-flush')) return flushOutbox();
      const chip = t.closest('#f-kat .chip:not(.add)');
      if (chip) {
        S.form.nama = chip.dataset.nama;
        $('#err-kat').textContent = '';
        if (!digits($('#f-nominal').value)) {
          const src = (S.form.jenis === 'Masuk' ? S.data.donatur : S.data.pos).find(x => x.nama === S.form.nama);
          const v = src && (src.komitmen || src.rutin);
          if (v) $('#f-nominal').value = dots(v);
        }
        return syncForm();
      }
      if (t.closest('#f-kat-add')) { $('#f-kat-new').classList.remove('hidden'); $('#f-kat-new-name').focus(); return; }
    });

    $('#fab').addEventListener('click', () => openForm());
    $('#btn-refresh').addEventListener('click', () => load());

    document.addEventListener('change', ev => {
      const cr = ev.target.closest('[data-cr]');
      if (cr) { S.period[cr.dataset.cr] = cr.value; store.set('period', S.period); render(); }
    });

    $('#f-jenis').addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (S.form.jenis !== b.dataset.v) { S.form.jenis = b.dataset.v; S.form.nama = ''; S.form.jumlah = 1; }
      syncForm();
    });
    $('#f-nominal').addEventListener('input', ev => { ev.target.value = dots(ev.target.value); $('#err-nominal').textContent = ''; syncForm(); });
    $('#f-bulan').addEventListener('change', syncForm);
    $('#f-minus').addEventListener('click', () => { S.form.jumlah = Math.max(1, S.form.jumlah - 1); syncForm(); });
    $('#f-plus').addEventListener('click', () => { S.form.jumlah = Math.min(24, S.form.jumlah + 1); syncForm(); });
    $('#form-tx').addEventListener('submit', submitForm);
    $('#f-delete').addEventListener('click', () => { if (S.form.tx) deleteTx(S.form.tx); });
    $('#f-kat-new-save').addEventListener('click', async () => {
      const nm = $('#f-kat-new-name').value;
      if (await addKategori(S.form.jenis, nm, '')) { S.form.nama = nm.trim(); $('#f-kat-new-name').value = ''; $('#f-kat-new').classList.add('hidden'); syncForm(); }
    });

    // riwayat
    let qT;
    $('#h-q').addEventListener('input', ev => { clearTimeout(qT); qT = setTimeout(() => { S.hist.q = ev.target.value; renderRiwayat(); }, 150); });
    $('#h-jenis').addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      S.hist.jenis = b.dataset.v;
      $$('#h-jenis button').forEach(x => x.classList.toggle('on', x === b));
      renderRiwayat();
    });
    $('#h-kat').addEventListener('change', ev => { S.hist.kat = ev.target.value; renderRiwayat(); });
    $('#h-from').addEventListener('change', ev => { S.hist.from = ev.target.value; renderRiwayat(); });
    $('#h-to').addEventListener('change', ev => { S.hist.to = ev.target.value; renderRiwayat(); });

    // pengaturan
    $('#form-login').addEventListener('submit', async ev => {
      ev.preventDefault();
      const btn = ev.target.querySelector('button');
      btn.disabled = true; btn.textContent = 'Memeriksa…';
      try {
        const j = await api('login', { pin: $('#login-pin').value });
        store.set('token', j.token);
        $('#login-pin').value = '';
        toast('Berhasil masuk sebagai pemilik', 'ok');
        await load(true);
      } catch (e) { toast(e.net ? 'Butuh internet untuk masuk.' : e.message, 'err', 4000); }
      finally { btn.disabled = false; btn.textContent = 'Masuk'; }
    });
    $('#btn-logout').addEventListener('click', async () => {
      const ok = await confirmBox('Keluar dari HP ini', 'HP ini akan kembali ke mode lihat saja. Untuk input lagi perlu PIN.');
      if (!ok) return;
      try { await api('logout'); } catch (e) { /* tetap keluar */ }
      store.del('token');
      S.role = store.get('viewKey') ? 'view' : null;
      if (!S.role) { S.data = null; store.del('cache'); }
      toast('Sudah keluar', 'ok');
      render(); load(true);
    });
    $('#btn-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(shareLink()); toast('Link disalin', 'ok'); }
      catch (e) { toast('Gagal menyalin. Tekan lama link untuk salin manual.', 'err'); }
    });
    $('#btn-share').addEventListener('click', async () => {
      if (navigator.share) { try { await navigator.share({ title: 'Kas Aby', text: 'Laporan infaq keluarga (lihat saja)', url: shareLink() }); } catch (e) { /* batal */ } }
      else { $('#btn-copy').click(); }
    });
    $('#kat-tab').addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      S.katTab = b.dataset.v;
      $$('#kat-tab button').forEach(x => x.classList.toggle('on', x === b));
      renderPengaturan();
    });
    $('#kat-nominal').addEventListener('input', ev => { ev.target.value = dots(ev.target.value); });
    $('#form-kat').addEventListener('submit', async ev => {
      ev.preventDefault();
      if (await addKategori(S.katTab, $('#kat-nama').value, $('#kat-nominal').value)) {
        $('#kat-nama').value = ''; $('#kat-nominal').value = '';
        renderPengaturan(); load(true);
      }
    });

    window.addEventListener('online', () => { $('#offline-bar').classList.add('hidden'); flushOutbox(); load(true); });
    window.addEventListener('offline', () => $('#offline-bar').classList.remove('hidden'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.role) load(true); });
  }

  /* ---------- start ---------- */
  function start() {
    try {
      const u = new URL(location.href);
      const k = u.searchParams.get('k');
      if (k) {
        if (k !== store.get('viewKey')) { store.set('viewKey', k); if (!store.get('token')) { S.role = 'view'; } }
        u.searchParams.delete('k');
        history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      }
    } catch (e) { /* abaikan */ }
    if (!store.get('token') && !store.get('viewKey')) { S.role = null; S.data = null; }
    if (!navigator.onLine) $('#offline-bar').classList.remove('hidden');
    bind();
    render();
    if (store.get('token') || store.get('viewKey')) load(true);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* abaikan */ });
    }
  }

  // tunggu Chart.js (defer) tanpa memblokir
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('load', () => { if (S.page === 'grafik') renderGrafik(); });
})();
