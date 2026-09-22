import type { KnowledgeDocument, KnowledgeHit } from '../shared/knowledge';

type Query = { readonly accountId: string; readonly jobId: string; readonly query: string };

function tokens(text: string): readonly string[] {
  const terms: string[] = [];
  for (const part of text.toLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(part)) {
      if (part.length === 1) terms.push(part);
      for (let index = 0; index < part.length - 1; index++) terms.push(part.slice(index, index + 2));
    } else terms.push(part);
  }
  return terms;
}

export function retrieveKnowledge(documents: readonly KnowledgeDocument[], query: Query): readonly KnowledgeHit[] {
  if (!query.accountId || !query.jobId) return [];
  const terms = [...new Set(tokens(query.query.slice(0, 12000)))];
  if (!terms.length) return [];
  const chunks = documents
    .filter(document => document.accountId === query.accountId && (document.scope === 'company' || document.jobId === query.jobId))
    .flatMap(document => {
      const result: { readonly hit: KnowledgeHit; readonly terms: readonly string[] }[] = [];
      for (let offset = 0; offset < document.text.length; offset += 700) {
        const text = document.text.slice(offset, offset + 800);
        result.push({ hit: { documentId: document.id, title: document.title, scope: document.scope, text }, terms: tokens(`${document.title}\n${text}`) });
        if (offset + 800 >= document.text.length) break;
      }
      return result;
    });
  const averageLength = chunks.reduce((sum, chunk) => sum + chunk.terms.length, 0) / Math.max(1, chunks.length);
  const frequencies = new Map(terms.map(term => [term, chunks.filter(chunk => chunk.terms.includes(term)).length]));
  return chunks.map((chunk, index) => {
    const counts = new Map<string, number>();
    for (const term of chunk.terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    const score = terms.reduce((sum, term) => {
      const frequency = counts.get(term) ?? 0;
      if (!frequency) return sum;
      const documentFrequency = frequencies.get(term) ?? 0;
      const inverse = Math.log(1 + (chunks.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
      return sum + inverse * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * chunk.terms.length / averageLength));
    }, 0);
    return { hit: chunk.hit, score, index };
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 6).map(item => item.hit);
}
