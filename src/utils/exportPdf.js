import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Costanti ─────────────────────────────────────────────────────────────────

const MOOD_LABEL = {
  1: 'Molto difficile',
  2: 'Difficile',
  3: 'Nella norma',
  4: 'Buono',
  5: 'Ottimo',
}

const INCIDENT_LABELS = {
  conflitto_ragazzi: 'Conflitto tra ragazzi',
  fuga:              'Fuga',
  problema_esterno:  'Problema esterno',
  altro:             'Altro',
}

const BRAND_DARK   = [30, 58, 95]     // #1e3a5f
const BRAND_MID    = [147, 197, 253]  // #93c5fd

const MARGIN_L     = 14
const MARGIN_R     = 14
const MARGIN_BOT   = 22   // spazio per footer
const HEADER_H     = 50   // altezza intestazione pagina
const CONTENT_START = HEADER_H + 6  // y dove inizia il contenuto
const LINE_H       = 5    // interlinea testo
const TITLE_H      = 9    // altezza riga titolo sezione

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('it-IT', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })
}

function fmtDateTime(iso) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  )
}

function fmtTime(t) { return t ? t.slice(0, 5) : '—' }

// ─── Fetch logo come Base64 ───────────────────────────────────────────────────

async function fetchLogoBase64(url) {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise(resolve => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror  = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// ─── Intestazione pagina ──────────────────────────────────────────────────────
//
// ctx.currentSubtitle: stringa mostrata sotto il titolo (es. data singolo diario
//                      oppure intervallo date per esport multiplo)

function drawPageHeader(ctx) {
  const { doc, logoBase64, orgName, structureName, structureAddress } = ctx
  const pageW    = doc.internal.pageSize.getWidth()

  // Banner colorato
  doc.setFillColor(...BRAND_DARK)
  doc.rect(0, 0, pageW, 24, 'F')

  // Nome app (sinistra)
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('TURNO', MARGIN_L, 15)

  // Logo struttura in alto a destra (dentro il banner)
  const LOGO_SIZE = 16
  const logoX = pageW - MARGIN_R - LOGO_SIZE
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'AUTO', logoX, 4, LOGO_SIZE, LOGO_SIZE)
    } catch { /* logo non valido, ignorato */ }
  }

  // Org · Struttura (destra, lascia spazio al logo se presente)
  const textRightX = logoBase64 ? logoX - 3 : pageW - MARGIN_R
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  if (orgName || structureName) {
    doc.text(
      [orgName, structureName].filter(Boolean).join('  ·  '),
      textRightX, 11, { align: 'right' },
    )
  }
  if (structureAddress) {
    doc.text(structureAddress, textRightX, 18, { align: 'right' })
  }

  // Titolo documento
  doc.setTextColor(...BRAND_DARK)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.text('Verbale di Consegna Turno', MARGIN_L, 36)

  // Sottotitolo (data diario o intervallo)
  if (ctx.currentSubtitle) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 100, 100)
    doc.text(ctx.currentSubtitle, MARGIN_L, 43)
  }

  // Linea separatrice
  doc.setDrawColor(...BRAND_MID)
  doc.setLineWidth(0.5)
  doc.line(MARGIN_L, 47, pageW - MARGIN_R, 47)
}

// ─── Controllo page-break ─────────────────────────────────────────────────────
//
// Verifica se `neededH` mm entrano nella pagina a partire da `y`.
// Se no: aggiunge pagina, ridisegna l'header e restituisce il nuovo y iniziale.

function checkPageBreak(ctx, y, neededH) {
  if (y + neededH > ctx.pageH - MARGIN_BOT) {
    ctx.doc.addPage()
    drawPageHeader(ctx)
    return CONTENT_START
  }
  return y
}

// ─── Tabella metadati turno ───────────────────────────────────────────────────

function drawMetaTable(ctx, diary, startY) {
  const { doc } = ctx
  autoTable(doc, {
    startY,
    theme: 'grid',
    styles:     { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: BRAND_DARK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold', textColor: [60, 60, 60] },
      1: { cellWidth: 'auto' },
    },
    body: [
      ['Operatore',    diary.profiles?.full_name ?? '—'],
      ['Data invio',   fmtDateTime(diary.created_at)],
      ['Orario turno', `${fmtTime(diary.shift_start)} – ${fmtTime(diary.shift_end)}`],
      ['Umore',        `${diary.mood}/5 — ${MOOD_LABEL[diary.mood] ?? ''}`],
      ['Modificato',   diary.edited_at ? `Sì · ${fmtDateTime(diary.edited_at)}` : 'No'],
    ],
    margin:   { left: MARGIN_L, right: MARGIN_R },
    // Ridisegna header se la tabella va a capo (improbabile ma sicuro)
    didAddPage: () => drawPageHeader(ctx),
  })
  return doc.lastAutoTable.finalY
}

// ─── Blocco testo con page-break automatico ───────────────────────────────────
//
// Strategia:
//   1. Calcola l'altezza totale del blocco.
//   2. Se non entra nella pagina corrente → nuova pagina prima di disegnare.
//   3. Se il blocco è più lungo di una pagina intera → fallback riga per riga
//      con page-break tra le righe (caso raro per note molto lunghe).

function drawTextBlock(ctx, title, body, startY, opts = {}) {
  const { doc } = ctx
  const pageW    = doc.internal.pageSize.getWidth()
  const contentW = pageW - MARGIN_L - MARGIN_R
  const textW    = contentW - 6

  const lines   = doc.splitTextToSize(body, textW)
  const blockH  = TITLE_H + lines.length * LINE_H + 10  // padding verticale

  let y = startY + 4

  // — Caso normale: il blocco entra in una pagina —
  const maxContentH = ctx.pageH - MARGIN_BOT - CONTENT_START
  if (blockH <= maxContentH) {
    y = checkPageBreak(ctx, y, blockH)

    // Sfondo opzionale (disegnato ora che y è definitivo)
    if (opts.bgColor) {
      doc.setFillColor(...opts.bgColor)
      doc.roundedRect(MARGIN_L, y - 2, contentW, blockH, 2, 2, 'F')
      if (opts.borderColor) {
        doc.setDrawColor(...opts.borderColor)
        doc.setLineWidth(0.4)
        doc.roundedRect(MARGIN_L, y - 2, contentW, blockH, 2, 2, 'S')
      }
    }

    // Titolo sezione
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...(opts.titleColor ?? [100, 100, 100]))
    doc.text(title.toUpperCase(), MARGIN_L + 3, y + 0.5)
    y += TITLE_H

    // Righe testo
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...(opts.textColor ?? [30, 30, 30]))
    doc.text(lines, MARGIN_L + 3, y)
    y += lines.length * LINE_H + 6

    return y
  }

  // — Caso raro: blocco più lungo di una pagina → riga per riga —
  y = checkPageBreak(ctx, y, TITLE_H + LINE_H * 2)  // garantisce spazio per il titolo

  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...(opts.titleColor ?? [100, 100, 100]))
  doc.text(title.toUpperCase(), MARGIN_L + 3, y + 0.5)
  y += TITLE_H

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...(opts.textColor ?? [30, 30, 30]))

  for (const line of lines) {
    y = checkPageBreak(ctx, y, LINE_H)
    doc.text(line, MARGIN_L + 3, y)
    y += LINE_H
  }

  return y + 6
}

// ─── Separatore visivo tra diari (export multiplo) ───────────────────────────

function drawDiarySeparator(ctx, y) {
  const { doc } = ctx
  const pageW = doc.internal.pageSize.getWidth()
  const sepY  = y + 5
  doc.setDrawColor(210, 210, 210)
  doc.setLineWidth(0.3)
  doc.line(MARGIN_L, sepY, pageW - MARGIN_R, sepY)
  return sepY + 8
}

// ─── Header sezione diario (export multiplo) ──────────────────────────────────

function drawDiarySectionHeader(ctx, diary, y) {
  const { doc } = ctx
  const pageW = doc.internal.pageSize.getWidth()
  const barH  = 9

  doc.setFillColor(...BRAND_DARK)
  doc.roundedRect(MARGIN_L, y, pageW - MARGIN_L - MARGIN_R, barH, 1, 1, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text(fmtDate(diary.created_at), MARGIN_L + 3, y + 6)

  const opName = diary.profiles?.full_name ?? '—'
  doc.setFont('helvetica', 'normal')
  doc.text(opName, pageW - MARGIN_R - 3, y + 6, { align: 'right' })

  return y + barH + 4
}

// ─── Render di un singolo diario (shared) ────────────────────────────────────

function renderDiaryContent(ctx, diary, startY, singleMode) {
  let y = startY

  // — Tabella metadati —
  y = drawMetaTable(ctx, diary, y)
  y += 6

  // — Episodio critico —
  if (diary.has_incident) {
    const incidentType = INCIDENT_LABELS[diary.incident_type] ?? diary.incident_type ?? ''
    const label = `NOTA EPISODIO CRITICO${incidentType ? ` — ${incidentType}` : ''}`
    y = drawTextBlock(ctx, label, diary.incident_notes?.trim() || '(nessuna descrizione aggiuntiva)', y, {
      bgColor:     [254, 242, 242],
      borderColor: [254, 202, 202],
      titleColor:  [185, 28, 28],
      textColor:   [30, 30, 30],
    })
    y += 4
  }

  // — Passaggio di consegne —
  if (diary.handover_notes?.trim()) {
    y = drawTextBlock(ctx, 'Passaggio di consegne', diary.handover_notes.trim(), y)
    y += 4
  }

  // — Note responsabile —
  if (diary.manager_notes?.trim()) {
    y = drawTextBlock(ctx, 'Note per la responsabile', diary.manager_notes.trim(), y)
    y += 4
  }

  // — Avviso modifica —
  if (diary.edited_at) {
    y = drawTextBlock(
      ctx,
      'Report modificato dopo la prima compilazione',
      `Ultima modifica: ${fmtDateTime(diary.edited_at)}`,
      y,
      {
        bgColor:     [255, 251, 235],
        borderColor: [253, 230, 138],
        titleColor:  [146, 64, 14],
        textColor:   [30, 30, 30],
      },
    )
  }

  return y
}

// ─── Footer di pagina ─────────────────────────────────────────────────────────

function addFooters(doc) {
  const pageCount = doc.internal.getNumberOfPages()
  const pageW     = doc.internal.pageSize.getWidth()
  const pageH     = doc.internal.pageSize.getHeight()

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(150, 150, 150)
    doc.text('Documento generato digitalmente tramite Turno', MARGIN_L, pageH - 8)
    doc.text(`Pagina ${i} di ${pageCount}`, pageW - MARGIN_R, pageH - 8, { align: 'right' })
  }
}

// ─── Export: singolo diario ───────────────────────────────────────────────────

export async function exportDiaryPdf(diary, orgName, structureName, structureAddress, logoUrl) {
  const logoBase64 = await fetchLogoBase64(logoUrl)
  const doc        = new jsPDF({ unit: 'mm', format: 'a4' })

  const ctx = {
    doc, orgName, structureName, structureAddress, logoBase64,
    pageH:           doc.internal.pageSize.getHeight(),
    currentSubtitle: fmtDate(diary.created_at),
  }

  drawPageHeader(ctx)
  renderDiaryContent(ctx, diary, CONTENT_START, true)
  addFooters(doc)

  const dateStr = new Date(diary.created_at).toISOString().slice(0, 10)
  const opName  = (diary.profiles?.full_name ?? 'operatore').toLowerCase().replace(/\s+/g, '-')
  doc.save(`verbale-${opName}-${dateStr}.pdf`)
}

// ─── Export: lista diari filtrati ─────────────────────────────────────────────
//
// I diari fluiscono in continuazione sulla stessa pagina.
// Una nuova pagina viene aggiunta solo quando non c'è spazio sufficiente
// per cominciare un nuovo diario (soglia: MIN_DIARY_START = 70 mm).

const MIN_DIARY_START = 70  // spazio minimo per avviare un nuovo blocco diario

export async function exportDiariesPdf(diaries, orgName, structureName, structureAddress, logoUrl) {
  if (!diaries.length) return

  const logoBase64 = await fetchLogoBase64(logoUrl)
  const doc        = new jsPDF({ unit: 'mm', format: 'a4' })

  // Sottotitolo: intervallo date
  const oldest = diaries[diaries.length - 1]
  const newest = diaries[0]
  const subtitle = diaries.length > 1
    ? `${fmtDate(oldest.created_at)} — ${fmtDate(newest.created_at)}`
    : fmtDate(newest.created_at)

  const ctx = {
    doc, orgName, structureName, structureAddress, logoBase64,
    pageH:           doc.internal.pageSize.getHeight(),
    currentSubtitle: subtitle,
  }

  drawPageHeader(ctx)
  let y = CONTENT_START

  for (let i = 0; i < diaries.length; i++) {
    const diary = diaries[i]

    if (i > 0) {
      // Controlla se c'è spazio per un nuovo diario sulla pagina corrente
      if (y + MIN_DIARY_START > ctx.pageH - MARGIN_BOT) {
        doc.addPage()
        drawPageHeader(ctx)
        y = CONTENT_START
      } else {
        y = drawDiarySeparator(ctx, y)
      }
    }

    // Header sezione (barra colorata con data + operatore)
    y = drawDiarySectionHeader(ctx, diary, y)

    // Contenuto del diario
    y = renderDiaryContent(ctx, diary, y, false)
    y += 6
  }

  addFooters(doc)

  const today = new Date().toISOString().slice(0, 10)
  const sName = (structureName ?? 'struttura').toLowerCase().replace(/\s+/g, '-')
  doc.save(`verbali-${sName}-${today}.pdf`)
}
