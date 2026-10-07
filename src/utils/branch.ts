const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/** «Реализовать форму вывода» → `realizovat-formu-vyvoda`, не длиннее `maxLength` и без обрыва на дефисе. */
export function slugify(text: string, maxLength = 40): string {
  const latin = [...text.toLowerCase()].map((char) => TRANSLIT[char] ?? char).join('')
  const slug = latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
  return slug
}

export interface IBranchNameInput {
  template: string
  key: string
  summary: string
  maxSlugLength?: number
}

/** Подставляет `{key}` и `{slug}`; пустой `{slug}` не оставляет «висящих» разделителей. */
export function buildBranchName({ template, key, summary, maxSlugLength }: IBranchNameInput): string {
  const slug = slugify(summary, maxSlugLength)

  return template
    .replace(/\{key\}/g, key)
    .replace(/\{slug\}/g, slug)
    .replace(/[-_.]+(?=\/|$)/g, '')
    .replace(/\/{2,}/g, '/')
}

/** Правила git check-ref-format в объёме, достаточном для имени ветки. Возвращает текст ошибки. */
export function validateBranchName(name: string): string | undefined {
  const value = name.trim()
  if (!value) {
    return 'Имя ветки не может быть пустым'
  }
  if (/[\s~^:?*[\\]/.test(value) || value.includes('..') || value.includes('@{')) {
    return 'Имя содержит недопустимые символы (пробелы и ~ ^ : ? * [ \\)'
  }
  if (value.startsWith('/') || value.endsWith('/') || value.startsWith('-') || value.startsWith('.')) {
    return 'Имя не может начинаться с «/», «-», «.» или заканчиваться «/»'
  }
  if (value.endsWith('.') || value.endsWith('.lock') || value.includes('//')) {
    return 'Имя не может заканчиваться на «.» или «.lock»'
  }
  return undefined
}
