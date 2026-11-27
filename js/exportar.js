import { iniciarPagina, listarPeriodos, preencherPeriodos, periodoRotulo, avisar, mostrarErro } from './pagina.js?v=202611271051';
import { sb, q } from './supabase.js?v=202611271051';
import { esc } from './util.js?v=202611271051';

// Exportar horário (PDF): grade da graduação por curso e turma, no mesmo desenho da planilha de horário
// (dias lado a lado com T1/T2; em cada horário: sigla, professor e sala).
const { main } = await iniciarPagina('exportar');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Exportar horário</h1>
    <p class="sub">Gera o PDF do horário da graduação por curso e turma, no formato da planilha (A4 deitado).</p></div>
  </header>
  <section class="card painel ex-form">
    <div class="ex-linha">
      <div class="campo" style="width:150px"><label for="per">Período</label><select id="per"></select></div>
      <div class="campo" style="flex:1 1 300px"><label for="curso">Curso</label><select id="curso"></select></div>
    </div>
    <div class="campo"><span class="rotulo">Turmas</span>
      <div class="ex-acoes-sel"><button type="button" class="btn btn-s" id="todas">Marcar todas</button><button type="button" class="btn btn-s" id="nenhuma">Desmarcar</button></div>
      <div id="turmas" class="ex-turmas"></div></div>
    <div class="ex-linha">
      <div class="campo"><span class="rotulo">Páginas</span>
        <div class="seg" role="radiogroup">
          <button type="button" class="sb sb-on" data-layout="uma" aria-checked="true">Uma turma por página</button>
          <button type="button" class="sb" data-layout="compacto" aria-checked="false">Turmas empilhadas</button></div></div>
      <div class="campo"><span class="rotulo">Cores</span>
        <div class="seg" role="radiogroup">
          <button type="button" class="sb sb-on" data-cor="sim" aria-checked="true">Colorido</button>
          <button type="button" class="sb" data-cor="nao" aria-checked="false">Preto e branco</button></div></div>
      <label class="check" style="align-self:flex-end;min-height:38px"><input type="checkbox" id="legenda" checked> Legenda das siglas</label>
    </div>
    <div id="msg" class="oculto" role="alert"></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button type="button" class="btn btn-p" id="baixar">Baixar PDF</button>
      <span class="muted" id="info" style="font-size:13px"></span></div>
  </section>`;

const $e = (s) => main.querySelector(s);
const periodos = await listarPeriodos();
let periodoId = preencherPeriodos($e('#per'), periodos);
let layout = 'uma', colorido = true;
let dados = null;

const [cursos, matrizes, profs, horarios] = await Promise.all([
  q(sb.from('cursos').select('id, nome, sigla, nivel, ativo').eq('nivel', 'graduacao').order('nome')),
  q(sb.from('matrizes').select('id, curso_id')),
  q(sb.from('professores').select('id, nome, apelido, cor')),
  q(sb.from('horarios_graduacao').select('*').order('numero')),
]);
const HS = horarios.filter((h) => h.tipo_dia === 'semana'), HSAB = horarios.filter((h) => h.tipo_dia === 'sabado');
$e('#curso').innerHTML = cursos.map((c) => `<option value="${c.id}">${esc(c.sigla ? `${c.sigla} · ${c.nome}` : c.nome)}</option>`).join('');

main.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => { layout = b.dataset.layout; marcar('[data-layout]', b); }));
main.querySelectorAll('[data-cor]').forEach((b) => b.addEventListener('click', () => { colorido = b.dataset.cor === 'sim'; marcar('[data-cor]', b); }));
function marcar(sel, b) { main.querySelectorAll(sel).forEach((x) => { x.classList.toggle('sb-on', x === b); x.setAttribute('aria-checked', String(x === b)); }); }
$e('#per').addEventListener('change', (e) => { periodoId = e.target.value; carregar(); });
$e('#curso').addEventListener('change', listarTurmas);
$e('#todas').addEventListener('click', () => main.querySelectorAll('[data-turma]').forEach((c) => { c.checked = true; }));
$e('#nenhuma').addEventListener('click', () => main.querySelectorAll('[data-turma]').forEach((c) => { c.checked = false; }));

async function carregar() {
  $e('#turmas').innerHTML = '<p class="carregando">Carregando…</p>';
  try {
    const turmas = await q(sb.from('turmas').select('id, matriz_id, semestre, identificacao, subturmas(id, nome)').eq('periodo_id', periodoId).gt('semestre', 0).order('semestre').order('identificacao'));
    const ids = turmas.map((t) => t.id);
    const aulas = ids.length ? await q(sb.from('v_aulas_horario').select('id, turma_id, componente_id, dia_semana, inicio, quantidade, ambientes').in('turma_id', ids)) : [];
    const aIds = aulas.map((a) => a.id);
    const [ap, as, comps] = await Promise.all([
      aIds.length ? q(sb.from('aula_professores').select('aula_id, professor_id').in('aula_id', aIds)) : [],
      aIds.length ? q(sb.from('aula_subturmas').select('aula_id, subturma_id').in('aula_id', aIds)) : [],
      q(sb.from('componentes').select('id, nome, sigla').in('matriz_id', [...new Set(turmas.map((t) => t.matriz_id))])),
    ]);
    for (const a of aulas) {
      a.profs = ap.filter((x) => x.aula_id === a.id).map((x) => profs.find((p) => p.id === x.professor_id)).filter(Boolean);
      a.subs = as.filter((x) => x.aula_id === a.id).map((x) => x.subturma_id);
      a.comp = comps.find((c) => c.id === a.componente_id);
    }
    for (const t of turmas) {
      t.subturmas.sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR', { numeric: true }));
      t.curso_id = matrizes.find((m) => m.id === t.matriz_id)?.curso_id;
      t.aulas = aulas.filter((a) => a.turma_id === t.id);
    }
    dados = { turmas };
    listarTurmas();
  } catch (e) { mostrarErro($e('#msg'), e); }
}

function listarTurmas() {
  const ts = dados.turmas.filter((t) => t.curso_id === $e('#curso').value);
  $e('#turmas').innerHTML = ts.length ? ts.map((t) => `<label class="check ex-turma"><input type="checkbox" data-turma="${t.id}" checked>
    <span><strong>${esc(t.identificacao)}</strong> · ${t.semestre}º sem. <span class="muted">(${t.aulas.length} aula${t.aulas.length === 1 ? '' : 's'}${t.subturmas.length ? ' · ' + t.subturmas.map((s) => s.nome).join('/') : ''})</span></span></label>`).join('')
    : '<p class="muted" style="margin:0">Este curso não tem turmas de graduação neste período.</p>';
  $e('#info').textContent = '';
}

// ---------------- desenho do PDF ----------------
const hm = (t) => String(t || '').slice(0, 5);
const curto = (p) => (p.apelido || '').trim() || p.nome.split(' ')[0];
const rgb = (hex) => { const h = (hex || '#888888').replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const escuro = (hex) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) < 150; };
const DIAS_PDF = ['', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
const VERMELHO = [192, 0, 0], PRETO = [13, 13, 13], CINZA = [217, 217, 217];

// linhas de horário com os intervalos entre elas
function linhasDe(L) {
  const out = [];
  L.forEach((h, i) => {
    if (i > 0 && hm(L[i - 1].fim) < hm(h.inicio)) out.push({ intervalo: true, de: hm(L[i - 1].fim), ate: hm(h.inicio) });
    out.push(h);
  });
  return out;
}
// tamanhos em mm: normal (uma turma por página) ou menor (turmas empilhadas, duas por folha)
let ALT_LIN = 4.6, ALT_INT = 4.6, ALT_CAB = 6, FONTE = 7.5, LEG = 3.4;

function alturaGrade(L) {
  return ALT_CAB * 2 + linhasDe(L).reduce((s, l) => s + (l.intervalo ? ALT_INT : ALT_LIN * 3), 0);
}

function desenharGrade(doc, t, dias, L, x0, y0, largura) {
  const subs = t.subturmas.length ? t.subturmas : [{ id: null, nome: 'Turma' }];
  const colH = 13, gap = 2;
  const larguraDia = (largura - colH - gap * (dias.length - 1)) / dias.length;
  const larguraSub = larguraDia / subs.length;
  doc.setLineWidth(0.15); doc.setDrawColor(60);
  // coluna de horários
  let y = y0 + ALT_CAB * 2;
  doc.setFontSize(7); doc.setTextColor(40);
  for (const l of linhasDe(L)) {
    if (l.intervalo) { y += ALT_INT; continue; }
    doc.text(hm(l.inicio), x0 + colH - 1.5, y + ALT_LIN * 1.5 + 1, { align: 'right' });
    y += ALT_LIN * 3;
  }
  dias.forEach((d, di) => {
    const xd = x0 + colH + di * (larguraDia + gap);
    // cabeçalho do dia
    doc.setFillColor(...(colorido ? VERMELHO : [255, 255, 255])); doc.rect(xd, y0, larguraDia, ALT_CAB, colorido ? 'FD' : 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...(colorido ? [255, 255, 255] : [0, 0, 0]));
    doc.text(DIAS_PDF[d], xd + larguraDia / 2, y0 + ALT_CAB * 0.7, { align: 'center' });
    subs.forEach((s, si) => {
      const xs = xd + si * larguraSub;
      doc.setFillColor(...(colorido ? PRETO : [255, 255, 255])); doc.rect(xs, y0 + ALT_CAB, larguraSub, ALT_CAB, colorido ? 'FD' : 'S');
      doc.setTextColor(...(colorido ? [255, 255, 255] : [0, 0, 0])); doc.setFontSize(8.5);
      doc.text(s.nome, xs + larguraSub / 2, y0 + ALT_CAB * 1.7, { align: 'center' });
    });
    let yy = y0 + ALT_CAB * 2;
    for (const l of linhasDe(L)) {
      if (l.intervalo) {
        doc.setFillColor(...CINZA); doc.rect(xd, yy, larguraDia, ALT_INT, 'FD');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(30);
        doc.text('INTERVALO', xd + larguraDia / 2, yy + ALT_INT * 0.72, { align: 'center' });
        yy += ALT_INT; continue;
      }
      subs.forEach((s, si) => {
        const xs = xd + si * larguraSub;
        const a = t.aulas.find((x) => x.dia_semana === d && l.numero >= x.inicio && l.numero < x.inicio + x.quantidade && (s.id ? x.subs.includes(s.id) : true));
        const p = a?.profs[0];
        const linhas = a ? [a.comp?.sigla || a.comp?.nome || '?', a.profs.map(curto).join(' / ') || '—', a.ambientes || ''] : ['', '', ''];
        linhas.forEach((txt, k) => {
          const yk = yy + k * ALT_LIN;
          if (k === 1 && p && colorido) { doc.setFillColor(...rgb(p.cor)); doc.rect(xs, yk, larguraSub, ALT_LIN, 'FD'); doc.setTextColor(...(escuro(p.cor) ? [255, 255, 255] : [0, 0, 0])); }
          else { doc.setFillColor(255, 255, 255); doc.rect(xs, yk, larguraSub, ALT_LIN, 'FD'); doc.setTextColor(20); }
          doc.setFont('helvetica', k === 0 ? 'bold' : 'normal');
          let fs = FONTE; doc.setFontSize(fs);
          while (txt && doc.getTextWidth(txt) > larguraSub - 1.2 && fs > 4.5) { fs -= 0.5; doc.setFontSize(fs); }
          if (txt) doc.text(txt, xs + larguraSub / 2, yk + ALT_LIN * 0.7, { align: 'center' });
        });
      });
      yy += ALT_LIN * 3;
    }
  });
}

function legendaDe(t) {
  const m = new Map();
  for (const a of t.aulas) {
    const k = a.comp?.id; if (!k) continue;
    const it = m.get(k) || { sigla: a.comp.sigla || '', nome: a.comp.nome, profs: new Set() };
    a.profs.forEach((p) => it.profs.add(`${curto(p)} (${p.nome})`));
    m.set(k, it);
  }
  return [...m.values()].sort((x, y) => x.sigla.localeCompare(y.sigla, 'pt-BR'))
    .map((i) => `${i.sigla} = ${i.nome}${i.profs.size ? ' · ' + [...i.profs].join(', ') : ''}`);
}

async function gerar() {
  const sel = [...main.querySelectorAll('[data-turma]:checked')].map((c) => dados.turmas.find((t) => t.id === c.dataset.turma));
  if (!sel.length) { avisar('Marque pelo menos uma turma.', 'aviso'); return; }
  const { jsPDF } = await import('https://esm.sh/jspdf@2.5.1');
  [ALT_LIN, ALT_INT, ALT_CAB, FONTE, LEG] = layout === 'uma' ? [4.6, 4.6, 6, 7.5, 3.4] : [3.2, 3.0, 4.6, 6.3, 2.8];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, H = 210, M = 10;
  const per = periodos.find((p) => p.id === periodoId), cur = cursos.find((c) => c.id === $e('#curso').value);
  const comLegenda = $e('#legenda').checked;
  let y = M, primeira = true;
  const rodape = () => {
    doc.setFontSize(7); doc.setTextColor(120); doc.setFont('helvetica', 'normal');
    doc.text(`${cur.nome} · ${periodoRotulo(per)} · gerado em ${new Date().toLocaleDateString('pt-BR')}`, M, H - 5);
    doc.text(`${doc.internal.getNumberOfPages()}`, W - M, H - 5, { align: 'right' });
  };
  for (const t of sel) {
    const temSab = t.aulas.some((a) => a.dia_semana === 6);
    // sábado: só os horários usados (do primeiro ao último)
    const usados = t.aulas.filter((a) => a.dia_semana === 6).flatMap((a) => Array.from({ length: a.quantidade }, (_, k) => a.inicio + k));
    const SAB = temSab ? HSAB.filter((h) => h.numero >= Math.min(...usados) && h.numero <= Math.max(...usados)) : [];
    const leg = comLegenda ? legendaDe(t) : [];
    const altLeg = leg.length ? 3 + Math.ceil(leg.length / 2) * LEG : 0;
    const altSab = temSab ? 4 + alturaGrade(SAB) : 0;
    const altSemana = alturaGrade(HS);
    const altTotal = 9 + (temSab ? Math.max(altSemana, altSab - 4) : altSemana) + altLeg + 3;
    if (!primeira && (layout === 'uma' || y + altTotal > H - 8)) { rodape(); doc.addPage(); y = M; }
    primeira = false;
    // título da turma
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0);
    doc.text(`${cur.sigla || cur.nome} · ${t.semestre}º semestre · ${t.identificacao}`, M, y + 5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(`Horário ${periodoRotulo(per)}`, W - M, y + 5, { align: 'right' });
    const yg = y + 9;
    if (temSab) {
      const larguraSab = Math.max(42, 26 * (t.subturmas.length || 1)) + 13;
      desenharGrade(doc, t, [1, 2, 3, 4, 5], HS, M, yg, W - 2 * M - larguraSab - 4);
      desenharGrade(doc, t, [6], SAB, W - M - larguraSab, yg, larguraSab);
      y = yg + Math.max(altSemana, alturaGrade(SAB));
    } else {
      desenharGrade(doc, t, [1, 2, 3, 4, 5], HS, M, yg, W - 2 * M);
      y = yg + altSemana;
    }
    if (leg.length) {
      y += 3; doc.setFontSize(layout === 'uma' ? 7 : 6.2); doc.setTextColor(60); doc.setFont('helvetica', 'normal');
      const meio = Math.ceil(leg.length / 2);
      leg.forEach((txt, i) => {
        const col = i < meio ? 0 : 1, lin = i < meio ? i : i - meio;
        let s = txt; while (doc.getTextWidth(s) > (W - 2 * M) / 2 - 4 && s.length > 10) s = s.slice(0, -2);
        doc.text(s === txt ? s : s + '…', M + col * ((W - 2 * M) / 2), y + 3 + lin * LEG);
      });
      y += Math.ceil(leg.length / 2) * LEG + 1;
    }
    y += layout === 'uma' ? 6 : 3;
  }
  rodape();
  const nome = `Horario_${(cur.sigla || cur.nome).replace(/\W+/g, '_')}_${per.ano}-${per.semestre}.pdf`;
  doc.save(nome);
  $e('#info').textContent = `${sel.length} turma(s) · ${doc.internal.getNumberOfPages()} página(s) · ${nome}`;
}

$e('#baixar').addEventListener('click', async (ev) => {
  ev.target.disabled = true; $e('#msg').classList.add('oculto');
  try { await gerar(); } catch (e) { mostrarErro($e('#msg'), e); } finally { ev.target.disabled = false; }
});

carregar();
