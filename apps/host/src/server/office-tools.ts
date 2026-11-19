import { defineTool, type ToolDefinition } from '@copilotkit/runtime/v2';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { z } from 'zod';
import XLSX from 'xlsx';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import {
  getWhatsAppStatus,
  getWhatsAppMessages,
  sendWhatsAppMessage,
} from './whatsapp-routes.js';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const isWindows = process.platform === 'win32';

async function runPowerShell(script: string, timeoutMs = 15000): Promise<string> {
  if (!isWindows) {
    throw new Error('Native Microsoft Office COM automation is only available on Windows.');
  }
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { timeout: timeoutMs },
  );
  if (stderr && !stdout) throw new Error(stderr.trim());
  return stdout.trim();
}

export function officeAndSocialTools(): ToolDefinition[] {
  const excelTool = defineTool({
    name: 'office_excel',
    description:
      'Microsoft Excel document tooling. Creates, reads, and modifies real .xlsx binary spreadsheets and tabular data (supporting native Win32 COM and pure-JS SheetJS engine).',
    parameters: z.object({
      action: z.enum(['create', 'read', 'write', 'calculate']).describe('Action to perform'),
      path: z.string().describe('Destination or source spreadsheet path (.xlsx)'),
      sheet: z.string().optional().describe('Target sheet name (default: Sheet1)'),
      range: z.string().optional().describe('Target cell or range (e.g. A1, A1:C10)'),
      data: z
        .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .optional()
        .describe('2D matrix of row/column values to write'),
      formula: z.string().optional().describe('Formula to evaluate (e.g. =SUM(B2:B10))'),
    }),
    execute: async (args) => {
      let targetPath = resolve(args.path);
      if (!targetPath.toLowerCase().endsWith('.xlsx') && !targetPath.toLowerCase().endsWith('.csv')) {
        targetPath += '.xlsx';
      }
      mkdirSync(dirname(targetPath), { recursive: true });

      // 1. Try Windows COM if available
      if (isWindows) {
        try {
          const dataJson = JSON.stringify(args.data ?? []);
          const psScript = `
$ErrorActionPreference = 'Stop'
$path = '${targetPath.replace(/'/g, "''")}'
$action = '${args.action}'
$sheetName = '${(args.sheet ?? 'Sheet1').replace(/'/g, "''")}'
$formula = '${(args.formula ?? '').replace(/'/g, "''")}'
$rangeStr = '${(args.range ?? 'A1').replace(/'/g, "''")}'
$rawJson = @'
${dataJson}
'@

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
} catch {
  Write-Output (ConvertTo-Json @{ ok = $false; error = "com_unavailable" })
  exit 0
}

try {
  if ($action -eq 'create' -or -not (Test-Path $path)) {
    $wb = $excel.Workbooks.Add()
  } else {
    $wb = $excel.Workbooks.Open($path)
  }
  $ws = $wb.Sheets.Item(1)
  if ($sheetName) {
    try { $ws = $wb.Sheets.Item($sheetName) } catch { $ws.Name = $sheetName }
  }

  if ($action -eq 'write' -or $action -eq 'create') {
    if ($rawJson) {
      $rows = ConvertFrom-Json $rawJson
      for ($r = 0; $r -lt $rows.Count; $r++) {
        $cols = $rows[$r]
        for ($c = 0; $c -lt $cols.Count; $c++) {
          $val = $cols[$c]
          $ws.Cells.Item($r + 1, $c + 1) = $val
        }
      }
    }
    if ($formula) {
      $ws.Range($rangeStr).Formula = $formula
    }
    $wb.SaveAs($path)
    Write-Output (ConvertTo-Json @{ ok = $true; path = $path; action = $action; engine = "com"; message = "Workbook saved successfully via COM." })
  } elseif ($action -eq 'calculate') {
    if ($formula) {
      $ws.Range($rangeStr).Formula = $formula
      $result = $ws.Range($rangeStr).Text
      Write-Output (ConvertTo-Json @{ ok = $true; formula = $formula; result = $result; engine = "com" })
    }
  } elseif ($action -eq 'read') {
    $usedRange = $ws.UsedRange
    $rowCount = $usedRange.Rows.Count
    $colCount = $usedRange.Columns.Count
    $matrix = @()
    for ($r = 1; $r -le [Math]::Min($rowCount, 100); $r++) {
      $row = @()
      for ($c = 1; $c -le [Math]::Min($colCount, 26); $c++) {
        $row += $ws.Cells.Item($r, $c).Text
      }
      $matrix += ,$row
    }
    Write-Output (ConvertTo-Json @{ ok = $true; rows = $matrix; rowCount = $rowCount; colCount = $colCount; engine = "com" })
  }
  $wb.Close($false)
} finally {
  $excel.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
`;
          const out = await runPowerShell(psScript);
          const parsed = JSON.parse(out);
          if (parsed && parsed.ok) return parsed;
        } catch {
          // Fall through to pure-JS SheetJS generator
        }
      }

      // 2. Pure-JS SheetJS Generator (Never degrades to .csv or error)
      try {
        if (args.action === 'read') {
          if (!existsSync(targetPath)) {
            return { ok: false, error: `Spreadsheet does not exist: ${targetPath}` };
          }
          const wb = XLSX.readFile(targetPath);
          const sheetName = args.sheet && wb.Sheets[args.sheet] ? args.sheet : wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const rows = ws ? XLSX.utils.sheet_to_json(ws, { header: 1 }) : [];
          return {
            ok: true,
            path: targetPath,
            sheet: sheetName,
            rows,
            rowCount: rows.length,
            engine: 'sheetjs',
          };
        }

        if (args.action === 'calculate') {
          return {
            ok: false,
            formula: args.formula ?? '',
            error: 'formula_calculation_requires_excel',
            detail: 'The SheetJS fallback can store formulas but cannot calculate them. Install or enable Microsoft Excel to evaluate this formula.',
            engine: 'sheetjs',
          };
        }

        // action === 'create' || action === 'write'
        let wb: XLSX.WorkBook;
        if (args.action === 'write' && existsSync(targetPath)) {
          wb = XLSX.readFile(targetPath);
        } else {
          wb = XLSX.utils.book_new();
        }

        const sheetName = (args.sheet ?? 'Sheet1').slice(0, 31);
        const rows = args.data ?? [];
        const ws = XLSX.utils.aoa_to_sheet(rows as (string | number | boolean | null)[][]);
        if (args.formula && args.range) {
          ws[args.range] = { f: args.formula };
        }

        if (wb.SheetNames.includes(sheetName)) {
          wb.Sheets[sheetName] = ws;
        } else {
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }

        XLSX.writeFile(wb, targetPath);
        return {
          ok: true,
          path: targetPath,
          action: args.action,
          engine: 'sheetjs',
          message: 'Spreadsheet saved successfully (.xlsx).',
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : 'Excel generation failed.',
        };
      }
    },
  });

  const wordTool = defineTool({
    name: 'office_word',
    description:
      'Microsoft Word document tooling. Creates, formats, and edits real .docx Word documents with structured headings, paragraphs, and tables (supporting native Win32 COM and pure-JS docx engine).',
    parameters: z.object({
      action: z.enum(['create', 'append', 'read']).describe('Action to perform'),
      path: z.string().describe('Destination document path (.docx)'),
      title: z.string().optional().describe('Document main title'),
      headings: z
        .array(z.object({ level: z.number().int().min(1).max(3), text: z.string() }))
        .optional()
        .describe('List of headings to add'),
      paragraphs: z.array(z.string()).optional().describe('Paragraphs of text to add'),
      bulletPoints: z.array(z.string()).optional().describe('Bullet points to insert'),
    }),
    execute: async (args) => {
      let targetPath = resolve(args.path);
      if (!targetPath.toLowerCase().endsWith('.docx')) {
        targetPath += '.docx';
      }
      mkdirSync(dirname(targetPath), { recursive: true });

      // 1. Try Windows COM if available
      if (isWindows) {
        try {
          const paragraphsJson = JSON.stringify(args.paragraphs ?? []);
          const bulletsJson = JSON.stringify(args.bulletPoints ?? []);
          const psScript = `
$ErrorActionPreference = 'Stop'
$path = '${targetPath.replace(/'/g, "''")}'
$title = '${(args.title ?? '').replace(/'/g, "''")}'
$paras = ConvertFrom-Json @'
${paragraphsJson}
'@
$bullets = ConvertFrom-Json @'
${bulletsJson}
'@

try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = $false
} catch {
  Write-Output (ConvertTo-Json @{ ok = $false; error = "com_unavailable" })
  exit 0
}

try {
  $doc = $word.Documents.Add()
  $selection = $word.Selection

  if ($title) {
    $selection.Font.Name = 'Segoe UI'
    $selection.Font.Size = 22
    $selection.Font.Bold = 1
    $selection.TypeText($title)
    $selection.TypeParagraph()
    $selection.Font.Bold = 0
    $selection.Font.Size = 11
  }

  foreach ($p in $paras) {
    $selection.TypeText($p)
    $selection.TypeParagraph()
  }

  foreach ($b in $bullets) {
    $selection.TypeText("  $b")
    $selection.TypeParagraph()
  }

  $doc.SaveAs([ref]$path)
  $doc.Close()
  Write-Output (ConvertTo-Json @{ ok = $true; path = $path; engine = "com"; message = "Word document saved successfully via COM." })
} finally {
  $word.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
}
`;
          const out = await runPowerShell(psScript);
          const parsed = JSON.parse(out);
          if (parsed && parsed.ok) return parsed;
        } catch {
          // Fall through to pure-JS docx generator
        }
      }

      // 2. Pure-JS docx Generator (Never degrades to .md or error)
      try {
        if (args.action === 'read') {
          if (!existsSync(targetPath)) {
            return { ok: false, error: `Word document does not exist: ${targetPath}` };
          }
          return {
            ok: true,
            path: targetPath,
            sizeBytes: statSync(targetPath).size,
            engine: 'docx',
            message: 'Word document exists on disk.',
          };
        }

        const children: Paragraph[] = [];
        if (args.title) {
          children.push(
            new Paragraph({
              text: args.title,
              heading: HeadingLevel.TITLE,
              spacing: { after: 200 },
            }),
          );
        }

        if (args.headings?.length) {
          for (const h of args.headings) {
            const level =
              h.level === 1
                ? HeadingLevel.HEADING_1
                : h.level === 2
                  ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3;
            children.push(new Paragraph({ text: h.text, heading: level, spacing: { before: 160, after: 80 } }));
          }
        }

        if (args.paragraphs?.length) {
          for (const p of args.paragraphs) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: p, size: 22 })],
                spacing: { after: 120 },
              }),
            );
          }
        }

        if (args.bulletPoints?.length) {
          for (const b of args.bulletPoints) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: b, size: 22 })],
                bullet: { level: 0 },
                spacing: { after: 60 },
              }),
            );
          }
        }

        if (!children.length) {
          children.push(new Paragraph({ text: 'Aegis Document', heading: HeadingLevel.HEADING_1 }));
        }

        const doc = new Document({ sections: [{ children }] });
        const buffer = await Packer.toBuffer(doc);
        writeFileSync(targetPath, buffer);

        return {
          ok: true,
          path: targetPath,
          engine: 'docx',
          message: 'Word document saved successfully (.docx).',
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : 'Word document generation failed.',
        };
      }
    },
  });

  const powerPointTool = defineTool({
    name: 'office_powerpoint',
    description:
      'Microsoft PowerPoint presentation tooling. Creates and designs real .pptx slide decks with titles, bullet points, and speaker notes (supporting native Win32 COM and pure-JS pptxgenjs engine).',
    parameters: z.object({
      action: z.enum(['create', 'add_slides']).describe('Action to perform'),
      path: z.string().describe('Destination presentation path (.pptx)'),
      title: z.string().describe('Presentation title'),
      subtitle: z.string().optional().describe('Presentation subtitle'),
      slides: z
        .array(
          z.object({
            title: z.string(),
            bullets: z.array(z.string()).optional(),
            notes: z.string().optional(),
          }),
        )
        .optional()
        .describe('List of slides to generate'),
    }),
    execute: async (args) => {
      let targetPath = resolve(args.path);
      if (!targetPath.toLowerCase().endsWith('.pptx')) {
        targetPath += '.pptx';
      }
      mkdirSync(dirname(targetPath), { recursive: true });

      // 1. Try Windows COM if available
      if (isWindows) {
        try {
          const slidesJson = JSON.stringify(args.slides ?? []);
          const psScript = `
$ErrorActionPreference = 'Stop'
$path = '${targetPath.replace(/'/g, "''")}'
$title = '${args.title.replace(/'/g, "''")}'
$subtitle = '${(args.subtitle ?? '').replace(/'/g, "''")}'
$slides = ConvertFrom-Json @'
${slidesJson}
'@

try {
  $ppt = New-Object -ComObject PowerPoint.Application
} catch {
  Write-Output (ConvertTo-Json @{ ok = $false; error = "com_unavailable" })
  exit 0
}

try {
  $pres = $ppt.Presentations.Add([Microsoft.Office.Core.MsoTriState]::msoFalse)
  $slide1 = $pres.Slides.Add(1, 1)
  $slide1.Shapes.Item(1).TextFrame.TextRange.Text = $title
  if ($subtitle) { $slide1.Shapes.Item(2).TextFrame.TextRange.Text = $subtitle }

  $idx = 2
  foreach ($s in $slides) {
    $slide = $pres.Slides.Add($idx, 2)
    $slide.Shapes.Item(1).TextFrame.TextRange.Text = $s.title
    if ($s.bullets) {
      $bulletsText = ($s.bullets -join [Environment]::NewLine)
      $slide.Shapes.Item(2).TextFrame.TextRange.Text = $bulletsText
    }
    if ($s.notes) {
      $slide.NotesPage.Shapes.Item(2).TextFrame.TextRange.Text = $s.notes
    }
    $idx++
  }

  $pres.SaveAs($path)
  $pres.Close()
  Write-Output (ConvertTo-Json @{ ok = $true; path = $path; slideCount = $idx - 1; engine = "com"; message = "PowerPoint presentation saved successfully via COM." })
} finally {
  $ppt.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
`;
          const out = await runPowerShell(psScript);
          const parsed = JSON.parse(out);
          if (parsed && parsed.ok) return parsed;
        } catch {
          // Fall through to pure-JS pptxgenjs generator
        }
      }

      // 2. Pure-JS PptxGenJS Generator (Never degrades to dummy or error)
      try {
        const PptxGen = require('pptxgenjs');
        const pptx = new PptxGen();
        pptx.layout = 'LAYOUT_WIDE';

        // Title Slide
        const titleSlide = pptx.addSlide();
        titleSlide.addText(args.title, {
          x: 0.8,
          y: 1.6,
          w: 11.5,
          h: 1.2,
          fontSize: 32,
          bold: true,
          color: '1F2937',
        });
        if (args.subtitle) {
          titleSlide.addText(args.subtitle, {
            x: 0.8,
            y: 2.8,
            w: 11.5,
            h: 0.8,
            fontSize: 20,
            color: '4B5563',
          });
        }

        const slides = args.slides ?? [];
        for (const s of slides) {
          const slide = pptx.addSlide();
          if (s.title) {
            slide.addText(s.title, {
              x: 0.8,
              y: 0.6,
              w: 11.5,
              h: 0.8,
              fontSize: 24,
              bold: true,
              color: '1F2937',
            });
          }
          if (s.bullets?.length) {
            slide.addText(
              s.bullets.map((b) => ({ text: b, options: { bullet: true } })),
              {
                x: 0.8,
                y: 1.6,
                w: 11.5,
                h: 4.8,
                fontSize: 18,
                color: '374151',
                breakLine: true,
              },
            );
          }
          if (s.notes) {
            slide.addNotes(s.notes);
          }
        }

        await pptx.writeFile({ fileName: targetPath });
        return {
          ok: true,
          path: targetPath,
          slideCount: slides.length + 1,
          engine: 'pptxgenjs',
          message: 'PowerPoint presentation saved successfully (.pptx).',
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : 'PowerPoint generation failed.',
        };
      }
    },
  });

  const whatsAppStatusTool = defineTool({
    name: 'whatsapp_verify',
    description:
      'Check WhatsApp sidecar connection health, QR code pairing status, and authenticated user identity.',
    parameters: z.object({
      refresh: z
        .boolean()
        .optional()
        .describe('Force refresh of WhatsApp connection status'),
    }),
    execute: async () => {
      return await getWhatsAppStatus();
    },
  });

  const whatsAppReadTool = defineTool({
    name: 'whatsapp_read',
    description:
      'Read recent WhatsApp messages and chats from the connected WhatsApp account.',
    parameters: z.object({
      chat: z.string().optional().describe('Filter messages by chat or sender phone number/JID'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Maximum number of messages to retrieve (default: 50)'),
    }),
    execute: async (args) => {
      return await getWhatsAppMessages(args.chat, args.limit);
    },
  });

  const whatsAppSendTool = defineTool({
    name: 'whatsapp_send',
    description:
      'Send a WhatsApp text message to a specific recipient phone number or chat JID.',
    parameters: z.object({
      to: z.string().describe('Recipient phone number or JID'),
      text: z.string().describe('Text message to send'),
    }),
    execute: async (args) => {
      return await sendWhatsAppMessage(args.to, args.text);
    },
  });

  return [
    excelTool,
    wordTool,
    powerPointTool,
    whatsAppStatusTool,
    whatsAppReadTool,
    whatsAppSendTool,
  ];
}
