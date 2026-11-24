export function validateDataset(data) {
  if (!data || !Array.isArray(data.words) || !data.words.length || !Array.isArray(data.chapters) || !data.chapters.length) throw new Error('词库格式错误');
  const ids = new Set(), chapters = new Set();
  const text = value => typeof value === 'string' && value.trim().length > 0;
  for (const chapter of data.chapters) {
    if (!chapter || !/^[1-9]\d*$/.test(chapter.id) || typeof chapter.id !== 'string' || !text(chapter.name) || chapters.has(chapter.id)) throw new Error('词库章节无效');
    chapters.add(chapter.id);
  }
  for (const word of data.words) {
    if (!word || !text(word.id) || !text(word.word) || ids.has(word.id) || typeof word.pos !== 'string' || !Array.isArray(word.meanings) || !word.meanings.length || !word.meanings.every(text) || !Array.isArray(word.variants) || !word.variants.length || !word.variants.every(text) || !Array.isArray(word.chapters) || !word.chapters.length || !word.chapters.every(id => chapters.has(id))) throw new Error('词库词条无效');
    for (const field of ['phonetic','example','translation','memory','usage']) if (word[field] !== undefined && typeof word[field] !== 'string') throw new Error('词库字段无效');
    ids.add(word.id);
  }
  return data;
}
export async function loadDataset(fetcher, localUrl, demoUrl) {
  let warning = '';
  try {
    const response = await fetcher(localUrl);
    if (response.ok) return { dataset: validateDataset(await response.json()), warning };
    if (response.status !== 404) warning = '本地词库暂时无法读取，已切换到示例词库。';
  } catch { warning = '本地词库无法读取或格式损坏，已切换到示例词库。'; }
  const response = await fetcher(demoUrl);
  if (!response.ok) throw new Error('无法读取示例词库');
  return { dataset: validateDataset(await response.json()), warning };
}
