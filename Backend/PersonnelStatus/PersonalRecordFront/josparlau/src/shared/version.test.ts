// Стори 10.9 — чистые функции подписи версии (AC-3).
//
// 🔴 ПОЧЕМУ ЗДЕСЬ НЕТ АССЕРТОВ НА ЗНАЧЕНИЕ SHA: `define` из vite.config.ts
// действует и в vitest (тест-конфиг живёт внутри того же файла, :26-32),
// поэтому BUILD_SHA в прогоне = РЕАЛЬНЫЙ короткий sha текущего коммита.
// `expect(BUILD_SHA).toBe('dee419f')` сгнил бы на следующем же коммите, а под
// env VAPS_BUILD_SHA гейта — сразу. Ассертим форму и ветки, а не значение.
import { describe, expect, it } from 'vitest'
import { APP_VERSION, BUILD_SHA, buildLabel, versionLabel } from './version'

describe('versionLabel (AC-3)', () => {
  it('складывает подпись из переданной версии, а не из константы модуля', () => {
    expect(versionLabel('9.9.9')).toBe('Версия 9.9.9')
  })

  it('берёт ИМЕННО аргумент: подпись двух разных версий различима', () => {
    // защита от «функция игнорирует аргумент и читает APP_VERSION» — на такой
    // реализации оба ассерта совпали бы и тест стал бы вакуумным
    expect(versionLabel('1.2.3')).not.toBe(versionLabel('4.5.6'))
  })
})

describe('buildLabel (AC-3)', () => {
  it('пустой sha → ПУСТАЯ строка (метка сборки не рендерится)', () => {
    expect(buildLabel('')).toBe('')
  })

  it('непустой sha → метка сборки с этим sha', () => {
    expect(buildLabel('deadbee')).toBe('сборка deadbee')
  })

  it('берёт ИМЕННО аргумент, а не константу BUILD_SHA', () => {
    expect(buildLabel('aaaaaaa')).not.toBe(buildLabel('bbbbbbb'))
  })
})

describe('константы define (AC-1, AC-2)', () => {
  // Не «украшение»: этот ассерт — единственное место в vitest, где вообще
  // исполняется чтение define'ов. Снятый define в vite.config.ts уронит
  // ИМЕННО его (ReferenceError на импорте модуля), а не абстрактную сборку.
  it('APP_VERSION доехал из define и это непустая строка', () => {
    expect(typeof APP_VERSION).toBe('string')
    expect(APP_VERSION).not.toBe('')
  })

  it('APP_VERSION — semver из трёх частей (architecture.md#L145)', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('BUILD_SHA — строка (пустая = «неизвестно», сборка вне git)', () => {
    expect(typeof BUILD_SHA).toBe('string')
  })
})
