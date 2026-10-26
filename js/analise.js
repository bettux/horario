// Leitura do período inteiro para Dashboard e Auditoria (somente leitura)
import { sb, q } from './supabase.js';

export async function carregarAnalise(periodo) {
  const [cursos, matrizes, turmas, comps, aulas, ambientes] = await Promise.all([
    q(sb.from('cursos').select('*')),
    q(sb.from('matrizes').select('*')),
    q(sb.from('turmas').select('*, subturmas(id, nome)').eq('periodo_id', periodo.id)),
    q(sb.from('componentes').select('*').eq('ativo', true)),
    q(sb.from('v_aulas_horario').select('id, turma_id, componente_id, quantidade, ambiente_id').eq('periodo_id', periodo.id)),
    q(sb.from('v_ambientes_uso').select('*')),
  ]);
  const ids = aulas.map((a) => a.id);
  const tids = turmas.map((t) => t.id);
  const [asubs, ofertas, encontros] = await Promise.all([
    ids.length ? q(sb.from('aula_subturmas').select('aula_id, subturma_id').in('aula_id', ids)) : [],
    tids.length ? q(sb.from('ofertas_pos').select('*').in('turma_id', tids)) : [],
    q(sb.from('v_encontros').select('id, oferta_id, turma_id, componente_id, modo, minutos').eq('periodo_id', periodo.id)),
  ]);
  const semanas = periodo.semanas_letivas || 20;

  const cursoDa = (t) => cursos.find((c) => c.id === matrizes.find((m) => m.id === t.matriz_id)?.curso_id);
  for (const t of turmas) {
    const c = cursoDa(t);
    const m = matrizes.find((x) => x.id === t.matriz_id);
    t.curso = c;
    t.pos = c?.nivel === 'pos';
    t.rotulo = t.pos ? `${c.sigla || c.nome} · ${t.identificacao}` : `${c.sigla || c.nome} · ${m.nome} · ${t.semestre}º sem. · ${t.identificacao}`;
    t.subturmas.sort((a, b) => a.nome.localeCompare(b.nome));
  }
  turmas.sort((a, b) => Number(a.pos) - Number(b.pos) || a.rotulo.localeCompare(b.rotulo));

  // ---------- graduação: componentes completos por turma ----------
  const ocupa = (k) => ['presencial', 'ead_sincrona'].includes(k.modalidade);
  function situacaoGrad(t) {
    const lista = comps.filter((k) => k.matriz_id === t.matriz_id && k.semestre === t.semestre && ocupa(k));
    const avisos = [];
    let completos = 0;
    for (const k of lista) {
      const aulasK = aulas.filter((a) => a.turma_id === t.id && a.componente_id === k.id);
      if (k.regra === 'pi_extensao') {
        if (aulasK.length) completos++;
        else if (k.professor !== 'opcional') avisos.push(`${k.nome} ainda não tem aula na grade.`);
        continue;
      }
      if (k.carga == null) { completos++; continue; }
      const porSub = t.subturmas.map((s) => ({ s, total: aulasK.filter((a) => asubs.some((x) => x.aula_id === a.id && x.subturma_id === s.id)).reduce((n, a) => n + a.quantidade, 0) * semanas }));
      const falta = porSub.filter((x) => x.total < k.carga);
      if (!falta.length) completos++;
      else avisos.push(`${k.nome} tem ${falta.map((x) => `${x.total} de ${k.carga} aulas${t.subturmas.length > 1 ? ' na ' + x.s.nome : ''}`).join(' e ')}.`);
    }
    return { total: lista.length, completos, avisos, aulas: aulas.filter((a) => a.turma_id === t.id).length };
  }

  // ---------- pós: módulos planejados ----------
  function situacaoPos(t) {
    const ofs = ofertas.filter((o) => o.turma_id === t.id);
    const avisos = [];
    const modulos = ofs.map((o) => {
      const k = comps.find((x) => x.id === o.componente_id);
      const min = encontros.filter((e) => e.oferta_id === o.id).reduce((n, e) => n + e.minutos, 0);
      const alvo = (k?.carga ?? 30) * 60;
      if (min < alvo) avisos.push(`${k?.nome} (${o.modo === 'semana' ? 'Semana' : 'Sábado'}) tem ${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''} de ${k?.carga ?? 30}h planejadas.`);
      return { o, k, min, alvo };
    });
    return {
      ofertas: ofs.length, completos: modulos.filter((x) => x.min >= x.alvo).length, avisos,
      encontros: encontros.filter((e) => e.turma_id === t.id).length,
      modos: [...new Set(ofs.map((o) => o.modo))],
    };
  }

  // ---------- ambientes com nomes parecidos ----------
  const chave = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b0+(\d)/g, '$1').replace(/\s+/g, '').trim();
  const grupos = new Map();
  for (const a of ambientes) { const k = chave(a.nome); grupos.set(k, [...(grupos.get(k) || []), a]); }
  const ambParecidos = [...grupos.values()].filter((g) => g.length > 1);

  return { turmas, comps, aulas, ofertas, encontros, ambientes, ambParecidos, situacaoGrad, situacaoPos, semanas };
}
