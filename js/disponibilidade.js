import { iniciarPagina, listarPeriodos, preencherPeriodos, avisar, mostrarErro } from './pagina.js';
import { sb, q, rpc } from './supabase.js';
import { esc, DIAS } from './util.js';

const { main } = await iniciarPagina('disponibilidade');

main.innerHTML = `
  <header class="cabecalho">
    <div><h1>Disponibilidade docente</h1>
    <p class="sub">Vale só para o período escolhido. Dia desmarcado significa indisponível.</p></div>
    <button class="btn btn-p" id="salvar" disabled>Salvar disponibilidade</button>
  </header>
  <section class="card barra">
    <div class="campo" style="flex:0 1 160px"><label for="per">Período letivo</label><select id="per"></select></div>
    <div class="campo" style="flex:1 1 280px"><label for="prof">Professor</label><select id="prof"></select></div>
  </section>
  <div id="msg" class="oculto" role="alert"></div>
  <div class="duas-colunas">
    <section class="larga" style="display:flex;flex-direction:column;gap:14px">
      <div class="card" id="dias" style="overflow:hidden"></div>
      <p class="muted" style="margin:0;font-size:13px;line-height:1.5">Cada período começa com a disponibilidade vazia. Nada é copiado de um período para outro.</p>
    </section>
    <aside class="card estreita painel" id="aulas"></aside>
  </div>`;

const [periodos, profs, horarios] = await Promise.all([
  listarPeriodos(),
  q(sb.from('professores').select('id, nome, nif').eq('ativo', true).order('nome')),
  q(sb.from('horarios_graduacao').select('*')),
]);
const selPer = main.querySelector('#per'), selProf = main.querySelector('#prof'), salvar = main.querySelector('#salvar');
const msg = main.querySelector('#msg');
let periodoId = preencherPeriodos(selPer, periodos);
selProf.innerHTML = profs.map((p) => `<option value="${p.id}">${esc(p.nome)} · NIF ${esc(p.nif)}</option>`).join('');
try { const ult = sessionStorage.getItem('disp-prof'); if (ult && profs.some((p) => p.id === ult)) selProf.value = ult; } catch { /* ignora */ }

// sugestões de horário: noite da graduação e sábado inteiro
const fimNoite = horarios.filter((h) => h.tipo_dia === 'semana').map((h) => h.fim).sort().pop()?.slice(0, 5) || '22:50';
const iniNoite = horarios.filter((h) => h.tipo_dia === 'semana').map((h) => h.inicio).sort()[0]?.slice(0, 5) || '18:25';
const padrao = (d) => (d === 6 ? ['08:00', '17:30'] : [iniNoite, fimNoite]);

if (!periodoId || !profs.length) {
  main.querySelector('#dias').innerHTML = `<p class="muted" style="padding:16px">${!periodoId ? 'Crie um período em Configurações acadêmicas.' : 'Cadastre professores primeiro.'}</p>`;
} else {
  carregar();
  selPer.addEventListener('change', () => { periodoId = selPer.value; carregar(); });
  selProf.addEventListener('change', () => { try { sessionStorage.setItem('disp-prof', selProf.value); } catch { /* ignora */ } carregar(); });
}

async function carregar() {
  msg.classList.add('oculto');
  const prof = selProf.value;
  const idsAulas = (await q(sb.from('aula_professores').select('aula_id').eq('professor_id', prof))).map((x) => x.aula_id);
  const [disp, aulas, encontros] = await Promise.all([
    q(sb.from('disponibilidades').select('*').eq('professor_id', prof).eq('periodo_id', periodoId)),
    idsAulas.length ? q(sb.from('v_aulas_horario').select('id, turma_id, componente, dia_semana, hi, hf').eq('periodo_id', periodoId).in('id', idsAulas)) : [],
    q(sb.from('v_encontros').select('componente, dia_semana, inicio, fim, data').eq('periodo_id', periodoId).eq('professor_id', prof).order('data')),
  ]);
  const dias = [1, 2, 3, 4, 5, 6].map((d) => {
    const r = disp.find((x) => x.dia_semana === d);
    const [pi, pf] = padrao(d);
    return `<div class="linha-form" style="grid-template-columns:160px 1fr 1fr;align-items:center;padding:12px 18px;border-bottom:1px solid var(--linha)">
      <label class="check" style="font-weight:600"><input type="checkbox" data-dia="${d}" ${r ? 'checked' : ''}> ${DIAS[d]}</label>
      <input type="time" aria-label="${DIAS[d]} das" data-ini="${d}" value="${(r?.inicio || pi).slice(0, 5)}" ${r ? '' : 'disabled'}>
      <input type="time" aria-label="${DIAS[d]} até" data-fim="${d}" value="${(r?.fim || pf).slice(0, 5)}" ${r ? '' : 'disabled'}></div>`;
  }).join('');
  main.querySelector('#dias').innerHTML = `<div class="linha-form" style="grid-template-columns:160px 1fr 1fr;padding:10px 18px;background:var(--superficie-2);font-size:12px;font-weight:600;color:var(--texto-suave)"><span>Dia</span><span>Das</span><span>Até</span></div>${dias}`;
  main.querySelectorAll('[data-dia]').forEach((c) => c.addEventListener('change', () => {
    main.querySelector(`[data-ini="${c.dataset.dia}"]`).disabled = !c.checked;
    main.querySelector(`[data-fim="${c.dataset.dia}"]`).disabled = !c.checked;
    salvar.disabled = false;
  }));
  main.querySelectorAll('[data-ini],[data-fim]').forEach((i) => i.addEventListener('input', () => { salvar.disabled = false; }));
  salvar.disabled = true;

  // aulas do professor no período (para conferir antes de desmarcar)
  const posPorDia = {};
  for (const e of encontros) {
    const k = `${e.dia_semana}|${e.inicio}|${e.fim}|${e.componente}`;
    posPorDia[k] = (posPorDia[k] || 0) + 1;
  }
  const linhas = [
    ...aulas.sort((a, b) => a.dia_semana - b.dia_semana || a.hi.localeCompare(b.hi)).map((a) => [a.dia_semana, a.hi, `<div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:8px 0;border-bottom:1px solid #F0F0F3"><span class="num">${DIAS[a.dia_semana].slice(0, 3)} ${a.hi.slice(0, 5)}–${a.hf.slice(0, 5)}</span><span style="text-align:right">${esc(a.componente)}</span></div>`]),
    ...Object.entries(posPorDia).map(([k, n]) => { const [d, i, f, c] = k.split('|'); return [+d, i, `<div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:8px 0;border-bottom:1px solid #F0F0F3"><span class="num">${DIAS[d].slice(0, 3)} ${i.slice(0, 5)}–${f.slice(0, 5)}</span><span style="text-align:right">Pós: ${esc(c)} (${n} encontros)</span></div>`]; }),
  ].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  const nome = profs.find((p) => p.id === selProf.value)?.nome.split(' ')[0];
  main.querySelector('#aulas').innerHTML = `<h2>Aulas de ${esc(nome)} no período</h2>${linhas.length ? linhas.map((l) => l[2]).join('') : '<p class="muted" style="margin:0">Nenhuma aula alocada ainda.</p>'}`;
}

salvar.addEventListener('click', async () => {
  msg.classList.add('oculto');
  try {
    const dias = [...main.querySelectorAll('[data-dia]:checked')].map((c) => {
      const d = +c.dataset.dia;
      const inicio = main.querySelector(`[data-ini="${d}"]`).value, fim = main.querySelector(`[data-fim="${d}"]`).value;
      if (!inicio || !fim || inicio >= fim) throw new Error(`${DIAS[d]}: o horário "das" precisa ser antes do "até".`);
      return { dia: d, inicio, fim };
    });
    salvar.disabled = true;
    await rpc('salvar_disponibilidade', { p_prof: selProf.value, p_periodo: periodoId, p_dias: dias });
    avisar('Disponibilidade salva.');
    carregar();
  } catch (e) {
    salvar.disabled = false;
    mostrarErro(msg, e);
  }
});
