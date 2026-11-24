// Calendário escolar em PDF, guardado no armazenamento privado do Supabase (<periodo_id>.pdf)
import { sb, q } from './supabase.js?v=202611241950';

const BALDE = 'calendarios';
const arquivo = (periodoId) => `${periodoId}.pdf`;

export async function enviarCalendario(periodoId, file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Envie um arquivo PDF.');
  if (file.size > 10 * 1024 * 1024) throw new Error('O PDF passa de 10 MB.');
  const { error } = await sb.storage.from(BALDE).upload(arquivo(periodoId), file, { upsert: true, contentType: 'application/pdf' });
  if (error) throw new Error(`Não foi possível enviar o PDF: ${error.message}`);
  await q(sb.from('periodos').update({ calendario_em: new Date().toISOString() }).eq('id', periodoId));
}

export async function removerCalendario(periodoId) {
  const { error } = await sb.storage.from(BALDE).remove([arquivo(periodoId)]);
  if (error) throw new Error(`Não foi possível remover o PDF: ${error.message}`);
  await q(sb.from('periodos').update({ calendario_em: null }).eq('id', periodoId));
}

// abre o PDF numa aba nova com um link temporário (5 minutos)
export async function abrirCalendario(periodoId) {
  const aba = window.open('', '_blank');
  const { data, error } = await sb.storage.from(BALDE).createSignedUrl(arquivo(periodoId), 300);
  if (error || !data?.signedUrl) { aba?.close(); throw new Error('Calendário ainda não publicado para este período.'); }
  if (aba) aba.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}
