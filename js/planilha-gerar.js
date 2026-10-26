// Monta a planilha de alocação (modelo confidencial da coordenação) a partir do planejamento.
// Módulo puro: recebe a biblioteca ExcelJS, o arquivo do modelo e os dados do período.
// Funciona no navegador e no Node (testes).

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MESES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DIAS_PLURAL = ['', 'Segundas', 'Terças', 'Quartas', 'Quintas', 'Sextas', 'Sábados', 'Domingos'];
const MESES_DIVIDIDOS = [8, 1]; // agosto e janeiro aparecem em duas colunas (1ª e 2ª quinzena)
const PALETA = ['FFCCFFFF', 'FFF875FF', 'FFCCFFCC', 'FFFFFF99', 'FFFFCC99', 'FFCCCCFF', 'FFFFCCFF', 'FF99CCFF', 'FFFFE699', 'FFC6E0B4', 'FFF4B183', 'FFB4C6E7'];
const cor = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
// O ExcelJS compartilha o objeto de estilo entre células iguais: sempre troca o estilo inteiro
const pintar = (cel, argb) => { cel.style = { ...structuredClone(cel.style || {}), fill: cor(argb) }; };

// Layout da aba do professor ("Nome docente")
const P = {
  col0: 10, base: 7, // J..P
  cab: [8, 27, 51, 55],
  grad: [9, 22], assinc: [23, 24], sinc: [25, 26], pos: [28, 36],
  estagio: 40, extensao: 41, ic: 42, coord: 43, cnpq: 44, distrito: 45, outras: [46, 48],
  formulas: { 37: (c) => `SUM(${c}9:${c}26)+SUM(${c}28:${c}36)`, 38: (c) => `ROUNDUP(SUM(${c}9:${c}26)*0.2,0)`, 39: (c) => `ROUNDUP(SUM(${c}28:${c}36)*0.1,0)`,
    49: (c) => `SUM(${c}38:${c}48)`, 50: (c) => `${c}37+${c}49`, 59: (c) => `SUM(${c}52:${c}58)`, 60: (c) => `ROUNDUP(SUM(${c}52:${c}54)*0.2,0)`,
    61: (c) => `ROUNDUP(SUM(${c}56:${c}58)*0.1,0)`, 63: (c) => `SUM(${c}59:${c}62)`, 64: (c) => `${c}63+${c}50` },
};

// ---------- utilidades ----------
function letra(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function data(iso) { const [a, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); }
function iso(dt) { return dt.toISOString().slice(0, 10); }
function br(isoStr) { const [a, m, d] = isoStr.split('-'); return `${d}/${m}/${a}`; }
function segunda(isoStr) { const dt = data(isoStr); const w = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - w); return iso(dt); }
function hora(t) { const [h, m] = String(t).split(':'); return `${h}h${m}`; }
function nif(v) { return /^\d+$/.test(String(v ?? '')) ? Number(v) : (v || null); }
function nomeAba(nome, usados) {
  let base = String(nome).replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Aba';
  let n = base, i = 2;
  while (usados.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  usados.add(n.toLowerCase());
  return n;
}
export function eExtensao(nome) { return /^\s*(atividades de )?extens/i.test(nome || ''); }

// Colunas de mês do período: agosto e janeiro em duas metades (dias 1–15 e 16–fim)
export function colunasMeses(inicio, fim) {
  const cols = [];
  const ini = data(inicio), f = data(fim);
  let a = ini.getUTCFullYear(), m = ini.getUTCMonth();
  while (a < f.getUTCFullYear() || (a === f.getUTCFullYear() && m <= f.getUTCMonth())) {
    const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
    const partes = MESES_DIVIDIDOS.includes(m + 1) ? [[1, 15, ' 1'], [16, ultimo, ' 2']] : [[1, ultimo, '']];
    for (const [d1, d2, suf] of partes) {
      let de = iso(new Date(Date.UTC(a, m, d1))), ate = iso(new Date(Date.UTC(a, m, d2)));
      if (ate < inicio || de > fim) continue;
      if (de < inicio) de = inicio;
      if (ate > fim) ate = fim;
      cols.push({ de, ate, mes: m + 1, ano: a, rotulo: `CH/semanal ${MESES[m]}/${String(a).slice(2)}${suf}`, dividida: !!suf });
    }
    if (++m > 11) { m = 0; a++; }
  }
  return cols;
}

// Converte fórmulas compartilhadas em fórmulas normais (evita erro ao copiar/alterar células)
function soltarFormulas(ws) {
  ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
    const v = c.value;
    if (v && typeof v === 'object' && (v.sharedFormula || v.shareType)) c.value = { formula: c.formula, result: v.result };
  }));
}

function clonar(wb, base, nome) {
  const ws = wb.addWorksheet(nome);
  const m = structuredClone(base.model);
  m.id = ws.id; m.name = nome; m.state = 'visible';
  m.mergeCells = m.merges;
  m.tables = [];
  ws.model = m;
  return ws;
}

function copiarFaixa(ws, r1, r2, destino) {
  const desloc = destino - r1;
  for (let r = r1; r <= r2; r++) {
    const o = ws.getRow(r), d = ws.getRow(r + desloc);
    if (o.height) d.height = o.height;
    o.eachCell({ includeEmpty: true }, (c, col) => {
      const n = d.getCell(col);
      n.style = structuredClone(c.style || {});
      if (!(c.isMerged && c.master !== c)) n.value = c.formula ? null : c.value;
    });
  }
  for (const rng of ws.model.merges) {
    const mt = rng.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!mt) continue;
    const a = Number(mt[2]), b = Number(mt[4]);
    if (a >= r1 && b <= r2) ws.mergeCells(`${mt[1]}${a + desloc}:${mt[3]}${b + desloc}`);
  }
}

// ---------- geração ----------
export async function gerarPlanilha(ExcelJS, modelo, d) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(modelo);
  const avisos = [];
  const baseProf = wb.getWorksheet('Nome docente');
  const baseGrad = wb.getWorksheet('_base_grad');
  const basePos = wb.getWorksheet('_base_pos');
  if (!baseProf || !baseGrad || !basePos) throw new Error('O arquivo de modelo não é o modelo preparado para o sistema (faltam as abas base). Envie o modelo correto na própria tela.');
  for (const ws of [baseProf, baseGrad, basePos]) soltarFormulas(ws);

  const per = d.periodo;
  const semanas = Number(per.semanas_letivas) || 20;
  const meses = colunasMeses(per.inicio, per.fim);
  const por = (lista) => new Map(lista.map((x) => [x.id, x]));
  const cursos = por(d.cursos), matrizes = por(d.matrizes), comps = por(d.componentes), profs = por(d.professores), turmas = por(d.turmas);
  const cursoDaTurma = (t) => cursos.get(matrizes.get(t.matriz_id)?.curso_id) || { nome: '?', sigla: '?', nivel: 'graduacao' };
  const rotuloCurso = (c) => (c.nivel === 'pos' ? c.sigla : `CST ${c.sigla}`);
  const subsOrdenadas = (t) => [...(t.subturmas || [])].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
  const subsDaAula = (a, t) => { const todas = subsOrdenadas(t); return a.subturmas?.length ? todas.filter((s) => a.subturmas.includes(s.id)) : todas; };
  const usados = new Set(wb.worksheets.map((w) => w.name.toLowerCase()));
  const novas = { prof: [], grad: [], pos: [] };

  // ---------- 1) uma aba por professor ----------
  const porProf = new Map();
  const reg = (id) => { if (!porProf.has(id)) porProf.set(id, { grad: new Map(), ext: { q: 0, turmas: new Set() }, pos: [], ativ: [] }); return porProf.get(id); };
  for (const a of d.aulas) {
    const t = turmas.get(a.turma_id), c = comps.get(a.componente_id);
    if (!t || !c) continue;
    for (const pid of a.professores) {
      const r = reg(pid);
      if (eExtensao(c.nome)) { r.ext.q += a.quantidade; r.ext.turmas.add(t.identificacao); continue; }
      const subs = subsDaAula(a, t);
      const k = `${t.id}|${c.id}|${subs.map((s) => s.id).join(',')}`;
      if (!r.grad.has(k)) r.grad.set(k, { t, c, subs, q: 0, temSubturmas: (t.subturmas || []).length > 0 });
      r.grad.get(k).q += a.quantidade;
    }
  }
  for (const o of d.ofertas) if (o.professor_id && o.encontros?.length) reg(o.professor_id).pos.push(o);
  for (const at of d.atividades) {
    if (at.frequencia !== 'semanal') { avisos.push(`${profs.get(at.professor_id)?.nome}: a atividade "${at.descricao}" é por período e não entra na planilha (só valores semanais).`); continue; }
    reg(at.professor_id).ativ.push(at);
  }

  const listaProfs = [...porProf.entries()].map(([id, r]) => ({ p: profs.get(id), r })).filter((x) => x.p)
    .sort((a, b) => a.p.nome.localeCompare(b.p.nome, 'pt-BR'));

  for (const { p, r } of listaProfs) {
    const ws = clonar(wb, baseProf, nomeAba(p.nome, usados));
    novas.prof.push(ws);
    ws.getCell('B2').value = nif(p.nif);
    ws.getCell('B3').value = p.nome;
    prepararMeses(ws, meses, avisos, p.nome);
    const colsMes = meses.map((_, i) => letra(P.col0 + i));
    const todas = (row, valor) => colsMes.forEach((cl) => { ws.getCell(`${cl}${row}`).value = typeof valor === 'function' ? valor(cl) : valor; });

    // graduação: presencial, EaD assíncrona e EaD síncrona
    const grupos = { presencial: [], ead_assincrona: [], ead_sincrona: [] };
    for (const g of r.grad.values()) (grupos[g.c.modalidade] || grupos.presencial).push(g);
    const ordem = (a, b) => rotuloCurso(cursoDaTurma(a.t)).localeCompare(rotuloCurso(cursoDaTurma(b.t))) || a.t.semestre - b.t.semestre || a.c.nome.localeCompare(b.c.nome, 'pt-BR') || b.subs.length - a.subs.length;
    const faixas = { presencial: P.grad, ead_assincrona: P.assinc, ead_sincrona: P.sinc };
    const nomesFaixa = { presencial: 'aulas de graduação', ead_assincrona: 'aulas EaD assíncronas', ead_sincrona: 'aulas EaD síncronas' };
    for (const [mod, lista] of Object.entries(grupos)) {
      lista.sort(ordem);
      const [ini, fim] = faixas[mod];
      if (lista.length > fim - ini + 1) avisos.push(`${p.nome}: ${lista.length} linhas de ${nomesFaixa[mod]}, mas o modelo comporta ${fim - ini + 1}. As excedentes ficaram de fora.`);
      lista.slice(0, fim - ini + 1).forEach((g, i) => {
        const row = ini + i, ch = g.q * semanas;
        const nomes = g.subs.map((s) => s.nome);
        const det = !g.temSubturmas ? `CH ${ch}` : nomes.length > 1 ? `CHT ${ch} - ${nomes.join(' e ')}` : `CHP ${ch} - ${nomes[0]}`;
        ws.getCell(`B${row}`).value = rotuloCurso(cursoDaTurma(g.t));
        ws.getCell(`C${row}`).value = `${g.c.nome} (${det})`;
        ws.getCell(`G${row}`).value = ch;
        ws.getCell(`I${row}`).value = g.t.semestre;
        todas(row, () => ({ formula: `$H${row}` }));
      });
    }

    // pós-graduação
    const pos = [...r.pos].sort((a, b) => a.encontros[0].data.localeCompare(b.encontros[0].data));
    const [pi, pf] = P.pos;
    if (pos.length > pf - pi + 1) avisos.push(`${p.nome}: ${pos.length} módulos de pós, mas o modelo comporta ${pf - pi + 1}. Os excedentes ficaram de fora.`);
    pos.slice(0, pf - pi + 1).forEach((o, i) => {
      const row = pi + i, c = comps.get(o.componente_id), t = turmas.get(o.turma_id);
      const datas = o.encontros.map((e) => e.data).sort();
      ws.getCell(`B${row}`).value = rotuloCurso(cursoDaTurma(t));
      ws.getCell(`C${row}`).value = c?.nome;
      ws.getCell(`D${row}`).value = `${br(datas[0])} - ${br(datas[datas.length - 1])}`;
      ws.getCell(`E${row}`).value = Number(c?.carga) || null;
      ws.getCell(`G${row}`).value = new Set(datas.map(segunda)).size;
      meses.forEach((m, k) => { if (datas.some((x) => x >= m.de && x <= m.ate)) ws.getCell(`${colsMes[k]}${row}`).value = { formula: `$H${row}` }; });
    });

    // extensão (aulas + atividades do tipo extensão)
    const ativ = (tipo) => r.ativ.filter((a) => a.tipo === tipo);
    const somar = (l) => l.reduce((n, a) => n + Number(a.quantidade), 0);
    const ext = r.ext.q + somar(ativ('extensao'));
    if (ext) {
      ws.getCell(`H${P.extensao}`).value = [...r.ext.turmas, ...ativ('extensao').map((a) => a.descricao)].join(', ');
      todas(P.extensao, ext);
    }
    const linhaSimples = (tipo, row, celTexto) => {
      const l = ativ(tipo); if (!l.length) return;
      if (celTexto) ws.getCell(celTexto).value = l.map((a) => a.descricao).join(' / ');
      todas(row, somar(l));
    };
    linhaSimples('estagio', P.estagio);
    linhaSimples('ic_orientacao', P.ic, `I${P.ic}`);
    linhaSimples('coordenacao_curso', P.coord, `E${P.coord}`);
    linhaSimples('pesquisa_cnpq', P.cnpq, `E${P.cnpq}`);
    linhaSimples('distrito', P.distrito);
    const outras = ativ('outras');
    const [oi, of] = P.outras;
    if (outras.length > of - oi + 1) avisos.push(`${p.nome}: ${outras.length} outras atividades, mas o modelo comporta ${of - oi + 1}. As excedentes ficaram de fora.`);
    outras.slice(0, of - oi + 1).forEach((a, i) => { ws.getCell(`C${oi + i}`).value = a.descricao; todas(oi + i, Number(a.quantidade)); });
  }
  const semNada = d.professores.filter((p) => p.ativo && !porProf.has(p.id));
  if (semNada.length) avisos.push(`Sem aulas nem atividades no período (sem aba): ${semNada.map((p) => p.nome).join(', ')}.`);

  // ---------- 2) Horário Graduação por curso ----------
  const horSem = d.horarios.filter((h) => h.tipo_dia === 'semana').sort((a, b) => a.numero - b.numero);
  const horSab = new Map(d.horarios.filter((h) => h.tipo_dia === 'sabado').map((h) => [h.numero, h]));
  const gradPorCurso = new Map();
  for (const t of d.turmas) {
    const c = cursoDaTurma(t);
    if (c.nivel === 'pos') continue;
    if (!gradPorCurso.has(c.id)) gradPorCurso.set(c.id, { c, turmas: [] });
    gradPorCurso.get(c.id).turmas.push(t);
  }
  for (const { c, turmas: ts } of [...gradPorCurso.values()].sort((a, b) => a.c.sigla.localeCompare(b.c.sigla))) {
    ts.sort((a, b) => a.semestre - b.semestre || a.identificacao.localeCompare(b.identificacao, 'pt-BR', { numeric: true }));
    const ws = clonar(wb, baseGrad, nomeAba(`Horário Graduação ${c.sigla}`, usados));
    novas.grad.push(ws);
    ws.getCell('A1').value = `CURSO SUPERIOR DE TECNOLOGIA EM ${c.nome.toUpperCase()} - PERÍODO NOTURNO - ${per.semestre}° SEMESTRE DE ${per.ano}`;
    ts.forEach((_, k) => { if (k > 0) copiarFaixa(ws, 2, 33, 2 + k * 34); });
    const cores = new Map();
    const corDe = (id) => { if (!cores.has(id)) cores.set(id, PALETA[cores.size % PALETA.length]); return cores.get(id); };
    ts.forEach((t, k) => {
      const o = k * 34;
      const subs = subsOrdenadas(t);
      if (subs.length > 2) avisos.push(`${c.sigla} ${t.identificacao}: a turma tem ${subs.length} subturmas e o modelo mostra só duas (${subs[0].nome} e ${subs[1].nome}).`);
      const lados = subs.length ? subs.slice(0, 2) : [null];
      ws.getCell(`C${3 + o}`).value = lados[0] ? `${t.identificacao} - ${lados[0].nome}` : t.identificacao;
      ws.getCell(`I${3 + o}`).value = lados[1] ? `${t.identificacao} - ${lados[1].nome}` : null;
      // horários das linhas
      for (let dia = 1; dia <= 5; dia++) horSem.forEach((h, i) => { if (i < 5) ws.getCell(`B${5 + (dia - 1) * 5 + i + o}`).value = hora(h.inicio); });
      const aulasT = d.aulas.filter((a) => a.turma_id === t.id);
      const slotsSab = [...new Set(aulasT.filter((a) => a.dia_semana === 6).flatMap((a) => Array.from({ length: a.quantidade }, (_, i) => a.inicio + i)))].sort((x, y) => x - y);
      if (slotsSab.length > 4) avisos.push(`${c.sigla} ${t.identificacao}: ${slotsSab.length} horários aos sábados, mas o modelo tem 4 linhas. Os excedentes ficaram de fora.`);
      slotsSab.slice(0, 4).forEach((n, i) => { const h = horSab.get(n); ws.getCell(`B${30 + i + o}`).value = h ? hora(h.inicio) : `${n}º`; });
      for (const a of aulasT) {
        const comp = comps.get(a.componente_id);
        if (!comp) continue;
        const cobre = subsDaAula(a, t);
        const ladosAula = subs.length ? lados.map((s, i) => (cobre.some((x) => x.id === s.id) ? i : -1)).filter((i) => i >= 0) : [0];
        const [p1, p2, ...resto] = a.professores.map((id) => profs.get(id)).filter(Boolean);
        if (resto.length) avisos.push(`${c.sigla} ${t.identificacao}, ${comp.nome}: mais de dois professores na mesma aula; o modelo mostra dois.`);
        for (let s = 0; s < a.quantidade; s++) {
          const slot = a.inicio + s;
          let row;
          if (a.dia_semana <= 5) { if (slot > 5) continue; row = 5 + (a.dia_semana - 1) * 5 + (slot - 1) + o; }
          else { const i = slotsSab.indexOf(slot); if (i < 0 || i > 3) continue; row = 30 + i + o; }
          for (const lado of ladosAula) {
            const c0 = lado === 0 ? 3 : 9;
            for (let cc = c0; cc < c0 + 6; cc++) pintar(ws.getCell(row, cc), corDe(comp.id));
            ws.getCell(row, c0).value = comp.sigla || null;
            ws.getCell(row, c0 + 1).value = comp.nome;
            ws.getCell(row, c0 + 2).value = p1 ? nif(p1.nif) : null;
            ws.getCell(row, c0 + 4).value = a.ambiente || null;
          }
          if (ladosAula.length > 1) ws.getCell(`O${row}`).value = 'Aula Teórica Consolidada em uma única sala';
          if (p2) {
            ws.getCell(`T${row}`).value = comp.sigla || null;
            ws.getCell(`U${row}`).value = comp.nome;
            ws.getCell(`V${row}`).value = nif(p2.nif);
            ws.getCell(`W${row}`).value = p2.nome;
            ws.getCell(`X${row}`).value = a.ambiente || null;
          }
        }
      }
    });
  }

  // ---------- 3) Horário Pós por turma ----------
  const posTurmas = d.turmas.filter((t) => cursoDaTurma(t).nivel === 'pos')
    .sort((a, b) => a.identificacao.localeCompare(b.identificacao, 'pt-BR', { numeric: true }));
  for (const t of posTurmas) {
    const ofs = d.ofertas.filter((o) => o.turma_id === t.id && o.encontros?.length)
      .sort((a, b) => a.encontros[0].data.localeCompare(b.encontros[0].data));
    if (!ofs.length) continue;
    const c = cursoDaTurma(t);
    const ws = clonar(wb, basePos, nomeAba(`Horário Pós ${t.identificacao}`, usados));
    novas.pos.push(ws);
    const enc = ofs.flatMap((o) => o.encontros);
    const datas = enc.map((e) => e.data).sort();
    const dias = [...new Set(datas.map((x) => ((data(x).getUTCDay() + 6) % 7) + 1))].sort();
    ws.getCell('B1').value = c.nome.toUpperCase();
    ws.getCell('B2').value = t.identificacao;
    ws.getCell('B3').value = dias.map((x) => DIAS_PLURAL[x]).join(dias.length > 2 ? ', ' : ' e ').replace(/, ([^,]*)$/, ' e $1');
    ws.getCell('B4').value = data(datas[0]);
    ws.getCell('B5').value = data(datas[datas.length - 1]);
    ws.getCell('B6').value = d.componentes.filter((x) => x.matriz_id === t.matriz_id && x.ativo !== false).reduce((n, x) => n + Number(x.carga || 0), 0) || null;
    const amb = [...new Set(enc.map((e) => e.ambiente).filter(Boolean))];
    ws.getCell('H5').value = amb.length ? `${per.semestre}S${per.ano} - ${amb.join(', ').toUpperCase()}` : null;
    if (ofs.length > 14) avisos.push(`Pós ${t.identificacao}: ${ofs.length} módulos, mas o modelo comporta 14 linhas.`);
    ofs.slice(0, 14).forEach((o, i) => {
      const row = 9 + i, comp = comps.get(o.componente_id), ds = o.encontros.map((e) => e.data).sort();
      ws.getCell(`A${row}`).value = comp?.nome;
      ws.getCell(`B${row}`).value = Number(comp?.carga) || null;
      ws.getCell(`E${row}`).value = 'Presencial';
      ws.getCell(`F${row}`).value = `${br(ds[0])} - ${br(ds[ds.length - 1])}`;
      ws.getCell(`G${row}`).value = profs.get(o.professor_id)?.nome || null;
    });
  }

  // ---------- ordem das abas e limpeza ----------
  const nome = (n) => wb.getWorksheet(n);
  const ordem = [nome('Fonte'), ...novas.prof, ...novas.grad, nome('Alunos IC-IT-Orientações'), ...novas.pos,
    nome('Contrato não inerente'), nome('Gratificação IFP'), nome('Alunos Estagiando ENG'), nome('Informações pós-admissão'), baseProf].filter(Boolean);
  for (const ws of wb.worksheets) if (!ordem.includes(ws) && ws !== baseGrad && ws !== basePos) ordem.push(ws);
  wb.removeWorksheet(baseGrad.id);
  wb.removeWorksheet(basePos.id);
  ordem.forEach((ws, i) => { ws.orderNo = i; });
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: Math.min(1, ordem.length - 1), visibility: 'visible' }];

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, avisos, resumo: { professores: novas.prof.length, graduacao: novas.grad.map((w) => w.name), pos: novas.pos.map((w) => w.name), meses: meses.map((m) => m.rotulo.replace('CH/semanal ', '')) } };
}

// Ajusta as colunas de mês da aba do professor ao período (o modelo vem com 7: J a P)
function prepararMeses(ws, meses, avisos, quem) {
  const estiloDiv = ws.getCell('J8').style, estiloNormal = ws.getCell('L8').style;
  const n = meses.length;
  if (n > P.base) {
    // mais meses que o modelo: abre colunas depois de P copiando o estilo de P e remove a tabela de apoio
    try { ws.unMergeCells('Q27:Q33'); } catch { /* já separada */ }
    for (let r = 27; r <= 40; r++) for (let c = 17; c <= 22; c++) { const cel = ws.getCell(r, c); cel.value = null; cel.style = {}; }
    for (let i = P.base; i < n; i++) {
      const col = P.col0 + i;
      ws.getColumn(col).width = ws.getColumn(16).width || 11.4;
      for (let r = 1; r <= 64; r++) {
        const cel = ws.getCell(r, col);
        if (cel.isMerged) continue;
        cel.style = structuredClone(ws.getCell(r, 16).style || {});
        cel.value = null;
      }
      const cl = letra(col);
      for (const [r, f] of Object.entries(P.formulas)) ws.getCell(`${cl}${r}`).value = { formula: f(cl) };
    }
  } else {
    for (let i = n; i < P.base; i++) ws.getColumn(P.col0 + i).hidden = true;
    tabelaApoio(ws, meses);
  }
  meses.forEach((m, i) => {
    for (const r of P.cab) {
      const cel = ws.getCell(r, P.col0 + i);
      cel.style = structuredClone(m.dividida ? estiloDiv : estiloNormal);
      cel.value = m.rotulo;
    }
  });
  if (n === 0) avisos.push(`${quem}: o período não tem meses válidos.`);
}

// Tabela auxiliar (R:V) com as semanas de cada mês do período
function tabelaApoio(ws, meses) {
  const porMes = [];
  for (const m of meses) {
    const ult = porMes[porMes.length - 1];
    if (ult && ult.mes === m.mes && ult.ano === m.ano) { ult.ate = m.ate; continue; }
    porMes.push({ ...m });
  }
  const semanasEntre = (de, ate) => { const s = new Set(); for (let dt = data(de); iso(dt) <= ate; dt.setUTCDate(dt.getUTCDate() + 1)) if (dt.getUTCDay() >= 1 && dt.getUTCDay() <= 6) s.add(segunda(iso(dt))); return s.size; };
  const fim = meses[meses.length - 1]?.ate;
  for (let r = 28; r <= 40; r++) for (const c of ['R', 'S', 'U', 'V']) ws.getCell(`${c}${r}`).value = null;
  porMes.forEach((m, i) => {
    const r = 28 + i, ult = porMes[porMes.length - 1];
    ws.getCell(`R${r}`).value = `${MESES_CURTO[m.mes - 1]}/${String(m.ano).slice(2)} a ${MESES_CURTO[ult.mes - 1]}/${String(ult.ano).slice(2)}`;
    ws.getCell(`S${r}`).value = semanasEntre(m.de, fim);
    ws.getCell(`U${r}`).value = new Date(Date.UTC(m.ano, m.mes - 1, 1));
    ws.getCell(`V${r}`).value = semanasEntre(m.de, m.ate);
  });
}
