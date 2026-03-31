/**
 * Parses targeting-data.txt (block format) into structured objects.
 * See comments at top of targeting-data.txt for authoring rules.
 */

function stripComments(lines) {
  return lines.filter((line) => !/^\s*#/.test(line));
}

function parseBlockLines(lines) {
  const record = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = /^([a-z_]+):\s*(.*)$/.exec(line);

    if (!keyMatch) {
      i += 1;
      continue;
    }

    const key = keyMatch[1];
    let first = keyMatch[2];
    const parts = [];
    if (first) parts.push(first);

    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      const nextIsKey = /^[a-z_]+:\s*/.test(next) && !/^\s/.test(next);
      if (nextIsKey) break;

      if (/^\s/.test(next)) {
        parts.push(next.replace(/^\s+/, ""));
      } else if (next === "" && parts.length > 0) {
        parts.push("");
      } else if (next === "") {
        i += 1;
        continue;
      } else {
        break;
      }
      i += 1;
    }

    record[key] = parts.join("\n").trim();
  }

  return record;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function collectSectionLines(lines, startIdx, stopRegexes) {
  const out = [];
  let i = startIdx;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (/^-{5,}$/.test(t)) break;
    if (stopRegexes.some((rx) => rx.test(t))) break;
    out.push(raw);
    i += 1;
  }
  return { lines: out, nextIdx: i };
}

function normalizeBullets(lines) {
  const items = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (/^-{5,}$/.test(t)) continue;
    const cleaned = t
      .replace(/^[-*]\s*/, "")
      .replace(/^\d+\.\s*/, "")
      .replace(/^[a-z]\.\s*/i, "")
      .trim();
    if (!cleaned) continue;
    if (/^-{5,}$/.test(cleaned)) continue;
    items.push(cleaned);
  }
  return items;
}

function parseTagLine(raw) {
  const t = String(raw || "").trim();
  const m = /^(?:[-*]\s*)?\*?\s*(AI|Legal|Notes?|Note)\s*:\s*(.*?)\s*\*?$/i.exec(t);
  if (!m) return null;
  const rawKey = m[1].toLowerCase();
  const key = rawKey.startsWith("note") ? "notes" : rawKey;
  return { key, value: m[2].trim() };
}

function splitTaggedLines(lines) {
  const cleanLines = [];
  const ai = [];
  const legal = [];
  const notes = [];
  for (const ln of lines) {
    const tag = parseTagLine(ln);
    if (!tag) {
      cleanLines.push(ln);
      continue;
    }
    if (tag.key === "ai" && tag.value) ai.push(tag.value);
    if (tag.key === "legal" && tag.value) legal.push(tag.value);
    if (tag.key === "notes" && tag.value) notes.push(tag.value);
  }
  return { cleanLines, ai, legal, notes };
}

function appendTagBuckets(target, parsed, prefix = "") {
  const p = prefix ? `${prefix}_` : "";
  if (parsed.ai.length) {
    const k = `${p}potential_ai_use_cases`;
    target[k] = target[k] ? `${target[k]}\n${parsed.ai.join("\n")}` : parsed.ai.join("\n");
  }
  if (parsed.legal.length) {
    const k = `${p}legal_analysis_processes`;
    target[k] = target[k] ? `${target[k]}\n${parsed.legal.join("\n")}` : parsed.legal.join("\n");
  }
  if (parsed.notes.length) {
    const k = `${p}other_notes`;
    target[k] = target[k] ? `${target[k]}\n${parsed.notes.join("\n")}` : parsed.notes.join("\n");
  }
}

function parseStructuredSteps(lines) {
  const steps = [];
  let current = null;

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (/^-{5,}$/.test(t)) continue;

    const numMatch = /^(\d+)\.\s*(.+)$/.exec(t);
    if (numMatch) {
      current = { text: numMatch[2].trim(), substeps: [] };
      steps.push(current);
      continue;
    }

    const alphaMatch = /^([a-z])\.\s*(.+)$/i.exec(t);
    if (alphaMatch) {
      if (!current) {
        current = { text: "", substeps: [] };
        steps.push(current);
      }
      current.substeps.push(alphaMatch[2].trim());
      continue;
    }

    const cleaned = t.replace(/^[-*]\s*/, "").trim();
    if (!cleaned) continue;

    if (!current) {
      current = { text: cleaned, substeps: [] };
      steps.push(current);
    } else if (current.substeps.length) {
      const last = current.substeps.length - 1;
      current.substeps[last] = `${current.substeps[last]} ${cleaned}`.trim();
    } else {
      current.text = `${current.text} ${cleaned}`.trim();
    }
  }

  return steps.filter((s) => s.text || s.substeps.length);
}

function parseSubprocesses(lines) {
  const subprocesses = [];
  let i = 0;
  let current = null;
  while (i < lines.length) {
    const t = lines[i].trim();
    const subMatch = /^[a-z]\)\s*Subprocess\s*\d*:\s*(.*)$/i.exec(t);
    if (subMatch) {
      if (current) subprocesses.push(current);
      current = {
        title: subMatch[1].trim(),
        inputs: [],
        outputs: [],
        steps: [],
        stepItems: [],
        potential_ai_use_cases: "",
        legal_analysis_processes: "",
        other_notes: "",
        inputs_potential_ai_use_cases: "",
        inputs_legal_analysis_processes: "",
        inputs_other_notes: "",
        outputs_potential_ai_use_cases: "",
        outputs_legal_analysis_processes: "",
        outputs_other_notes: "",
        steps_potential_ai_use_cases: "",
        steps_legal_analysis_processes: "",
        steps_other_notes: "",
      };
      i += 1;
      continue;
    }
    if (!current) {
      i += 1;
      continue;
    }
    if (/^i\)\s*Inputs:/i.test(t)) {
      const section = collectSectionLines(lines, i + 1, [
        /^ii\)\s*Outputs:/i,
        /^iii\)\s*Steps:/i,
        /^[a-z]\)\s*Subprocess/i,
      ]);
      const tagged = splitTaggedLines(section.lines);
      current.inputs.push(...normalizeBullets(tagged.cleanLines));
      appendTagBuckets(current, tagged, "inputs");
      i = section.nextIdx;
      continue;
    }
    if (/^ii\)\s*Outputs:/i.test(t)) {
      const section = collectSectionLines(lines, i + 1, [
        /^iii\)\s*Steps:/i,
        /^[a-z]\)\s*Subprocess/i,
      ]);
      const tagged = splitTaggedLines(section.lines);
      current.outputs.push(...normalizeBullets(tagged.cleanLines));
      appendTagBuckets(current, tagged, "outputs");
      i = section.nextIdx;
      continue;
    }
    if (/^iii\)\s*Steps:/i.test(t)) {
      const section = collectSectionLines(lines, i + 1, [
        /^[a-z]\)\s*Subprocess/i,
      ]);
      const tagged = splitTaggedLines(section.lines);
      current.steps.push(...normalizeBullets(tagged.cleanLines));
      current.stepItems = parseStructuredSteps(tagged.cleanLines);
      appendTagBuckets(current, tagged, "steps");
      i = section.nextIdx;
      continue;
    }
    const tag = parseTagLine(t);
    if (tag) {
      appendTagBuckets(current, {
        ai: tag.key === "ai" ? [tag.value] : [],
        legal: tag.key === "legal" ? [tag.value] : [],
        notes: tag.key === "notes" ? [tag.value] : [],
      });
      i += 1;
      continue;
    }
    i += 1;
  }
  if (current) subprocesses.push(current);
  return subprocesses;
}

function parseTargetingProcessText(rawText) {
  const lines = rawText.split(/\r?\n/);
  const phases = [];
  let i = 0;
  while (i < lines.length) {
    const phaseMatch = /^Phase number:\s*(.*)$/i.exec(lines[i].trim());
    if (!phaseMatch) {
      i += 1;
      continue;
    }

    const phaseNumberRaw = phaseMatch[1].trim();
    const phaseNumber = parseInt(phaseNumberRaw, 10);
    const titleLine = (lines[i + 1] || "").trim();
    const titleMatch = /^Phase title:\s*(.*)$/i.exec(titleLine);
    const title = (titleMatch?.[1] || "").trim();

    // Skip template/placeholder blocks with no phase number or title.
    if (!phaseNumberRaw || !title) {
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < lines.length && !/^Phase number:\s*/i.test(lines[j].trim())) {
      j += 1;
    }
    const blockLines = lines.slice(i, j);

    let description = "";
    const descLine = blockLines.find((ln) =>
      /^1\.\s*Phase description:/i.test(ln.trim())
    );
    if (descLine) {
      description = descLine.replace(/^1\.\s*Phase description:\s*/i, "").trim();
    }

    const inputHeaderIdx = blockLines.findIndex((ln) =>
      /^2\.\s*Phase Inputs:/i.test(ln.trim())
    );
    const outputHeaderIdx = blockLines.findIndex((ln) =>
      /^3\.\s*Phase outputs:/i.test(ln.trim())
    );
    const subHeaderIdx = blockLines.findIndex((ln) =>
      /^4\.\s*Subprocesses:/i.test(ln.trim())
    );

    let inputs = [];
    if (inputHeaderIdx >= 0) {
      const start = inputHeaderIdx + 1;
      const end = outputHeaderIdx >= 0 ? outputHeaderIdx : blockLines.length;
      const tagged = splitTaggedLines(blockLines.slice(start, end));
      inputs = normalizeBullets(tagged.cleanLines);
    }

    let outputs = [];
    if (outputHeaderIdx >= 0) {
      const start = outputHeaderIdx + 1;
      const end = subHeaderIdx >= 0 ? subHeaderIdx : blockLines.length;
      const tagged = splitTaggedLines(blockLines.slice(start, end));
      outputs = normalizeBullets(tagged.cleanLines);
    }

    let subs = [];
    if (subHeaderIdx >= 0) {
      subs = parseSubprocesses(blockLines.slice(subHeaderIdx + 1));
    }

    const phaseObj = {
      order: Number.isFinite(phaseNumber) ? phaseNumber : phases.length + 1,
      id: `phase_${phaseNumberRaw || phases.length + 1}_${slugify(title)}`,
      title,
      summary: description,
      body: description,
      inputs: inputs.join("\n"),
      outputs: outputs.join("\n"),
      subprocesses: subs,
      potential_ai_use_cases: "",
      legal_analysis_processes: "",
      other_notes: "",
    };
    const phaseTagged = splitTaggedLines(
      subHeaderIdx >= 0 ? blockLines.slice(0, subHeaderIdx) : blockLines
    );
    appendTagBuckets(phaseObj, phaseTagged);
    phases.push(phaseObj);

    i = j;
  }

  phases.sort((a, b) => (a.order || 0) - (b.order || 0));

  const subsByParent = new Map();
  for (const p of phases) {
    const mapped = (p.subprocesses || []).map((s, idx) => ({
      id: `${p.id}_sub_${idx + 1}`,
      title: s.title || `Subprocess ${idx + 1}`,
      order: idx + 1,
      body: s.steps.length ? s.steps.join("\n") : "",
      step_items: (s.stepItems || []).map((st, stepIdx) => ({
        id: `${p.id}_sub_${idx + 1}_step_${stepIdx + 1}`,
        text: st.text || "",
        substeps: st.substeps || [],
        potential_ai_use_cases: "",
        legal_analysis_processes: "",
        other_notes: "",
      })),
      inputs: s.inputs.join("\n"),
      outputs: s.outputs.join("\n"),
      legal_analysis: "",
      automation_opportunity: "",
      potential_ai_use_cases: s.potential_ai_use_cases || "",
      legal_analysis_processes: s.legal_analysis_processes || "",
      other_notes: s.other_notes || "",
      inputs_potential_ai_use_cases: s.inputs_potential_ai_use_cases || "",
      inputs_legal_analysis_processes: s.inputs_legal_analysis_processes || "",
      inputs_other_notes: s.inputs_other_notes || "",
      outputs_potential_ai_use_cases: s.outputs_potential_ai_use_cases || "",
      outputs_legal_analysis_processes: s.outputs_legal_analysis_processes || "",
      outputs_other_notes: s.outputs_other_notes || "",
      steps_potential_ai_use_cases: s.steps_potential_ai_use_cases || "",
      steps_legal_analysis_processes: s.steps_legal_analysis_processes || "",
      steps_other_notes: s.steps_other_notes || "",
    }));
    subsByParent.set(p.id, mapped);
  }

  const metadata = {
    title: "Military Targeting Process",
    subtitle: "Data is sourced from Joint Publication 3-60, Joint Targeting (28 Sept. 2018).",
    footer_note:
      "Content sourced from targeting_process.txt. Update that file to maintain this page.",
  };

  return {
    metadata,
    processes: phases.map((p) => ({
      id: p.id,
      title: p.title,
      order: p.order,
      summary: p.summary,
      body: p.body,
      inputs: p.inputs,
      outputs: p.outputs,
      legal_analysis: "",
      automation_opportunity: "",
      potential_ai_use_cases: p.potential_ai_use_cases || "",
      legal_analysis_processes: p.legal_analysis_processes || "",
      other_notes: p.other_notes || "",
      jp_reference: "",
    })),
    subsByParent,
    notes: [],
  };
}

export function parseTargetingData(rawText) {
  if (/^\s*Phase number:/m.test(rawText)) {
    return parseTargetingProcessText(rawText);
  }

  const lines = stripComments(rawText.split(/\r?\n/));
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    const begin = /^BEGIN\s+(\w+)\s*$/i.exec(line);
    if (begin) {
      const type = begin[1].toUpperCase();
      const inner = [];
      i += 1;
      while (i < lines.length && !/^END\s+\w+\s*$/i.test(lines[i].trim())) {
        inner.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type, fields: parseBlockLines(inner) });
      continue;
    }
    i += 1;
  }

  const metadata = blocks.find((b) => b.type === "METADATA")?.fields || {};
  const processes = blocks
    .filter((b) => b.type === "PROCESS")
    .map((b) => b.fields)
    .filter((f) => f.id);
  const subprocesses = blocks
    .filter((b) => b.type === "SUBPROCESS")
    .map((b) => b.fields)
    .filter((f) => f.id && f.parent);
  const notes = blocks
    .filter((b) => b.type === "NOTE")
    .map((b) => b.fields)
    .filter((f) => f.id);

  processes.sort(
    (a, b) => (parseInt(a.order, 10) || 0) - (parseInt(b.order, 10) || 0)
  );

  const subsByParent = new Map();
  for (const s of subprocesses) {
    const pid = s.parent;
    if (!subsByParent.has(pid)) subsByParent.set(pid, []);
    subsByParent.get(pid).push(s);
  }
  for (const [, arr] of subsByParent) {
    arr.sort(
      (a, b) => (parseInt(a.order, 10) || 0) - (parseInt(b.order, 10) || 0)
    );
  }

  return { metadata, processes, subsByParent, notes };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBody(text) {
  if (!text) return "";
  const paras = text.split(/\n\n+/).map((p) => p.replace(/\n/g, " ").trim());
  return paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
}

function formatListItems(text) {
  if (!text) return [];
  const raw = String(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (raw.length > 1) return raw;
  return raw[0]
    .split(/\s*;\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderPanels(legal, ai) {
  const legalHtml = legal
    ? `<article class="info-panel legal-panel"><h3>Legal analysis</h3>${formatBody(
        legal
      )}</article>`
    : "";
  const aiHtml = ai
    ? `<article class="info-panel ai-panel"><h3>Potential AI Use Cases</h3>${formatBody(
        ai
      )}</article>`
    : "";
  if (!legalHtml && !aiHtml) return "";
  return `<section class="info-grid">${legalHtml}${aiHtml}</section>`;
}

function renderSubprocessIo(sub) {
  const inItems = formatListItems(sub.inputs);
  const outItems = formatListItems(sub.outputs);
  const inHtml = inItems.length
    ? `<ul>${inItems.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
    : `<p class="io-empty">No inputs documented.</p>`;
  const outHtml = outItems.length
    ? `<ul>${outItems.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
    : `<p class="io-empty">No outputs documented.</p>`;
  return `<section class="sub-io-grid" aria-label="Subprocess inputs and outputs">
    <div class="sub-io-col" data-context-key="${escapeHtml(
      `subprocess-inputs:${sub.id}`
    )}">
      <h5>Inputs</h5>
      ${inHtml}
    </div>
    <div class="sub-io-col" data-context-key="${escapeHtml(
      `subprocess-outputs:${sub.id}`
    )}">
      <h5>Outputs</h5>
      ${outHtml}
    </div>
  </section>`;
}

function renderSubprocessSteps(sub) {
  const items = Array.isArray(sub.step_items) ? sub.step_items : [];
  if (!items.length) return "";
  const html = items
    .map((step) => {
      const ctxKey = `step:${step.id}`;
      const subHtml =
        step.substeps && step.substeps.length
          ? `<ol type="a">${step.substeps
              .map((s) => `<li>${escapeHtml(s)}</li>`)
              .join("")}</ol>`
          : "";
      return `<li class="step-item" data-context-key="${escapeHtml(
        ctxKey
      )}">${escapeHtml(step.text || "")}${subHtml}</li>`;
    })
    .join("");
  return `<section class="sub-steps" data-context-key="${escapeHtml(
    `subprocess-steps:${sub.id}`
  )}"><h5>Steps</h5><ol>${html}</ol></section>`;
}

function renderSubprocesses(subs) {
  if (!subs.length) return "";
  const items = subs
    .map((s) => {
      const ctxKey = `subprocess:${s.id}`;
      const io = renderSubprocessIo(s);
      const steps = renderSubprocessSteps(s);
      const panels = renderPanels(s.legal_analysis, s.automation_opportunity);
      return `<article class="subprocess-card" data-context-key="${escapeHtml(
        ctxKey
      )}"><h4>${escapeHtml(
        s.title || s.id
      )}</h4>${io}${steps}${panels}</article>`;
    })
    .join("");
  return `<section class="subprocesses"><h3>Sub-processes</h3>${items}</section>`;
}

function renderNotes(notes) {
  if (!notes.length) return "";
  const items = notes
    .map(
      (n) =>
        `<article class="note-item"><h4>${escapeHtml(n.title || n.id)}</h4>${formatBody(
          n.body
        )}</article>`
    )
    .join("");
  return `<section class="notes-panel"><h3>Research notes</h3>${items}</section>`;
}

function renderDiagramIoBlocks(proc) {
  if (!proc) return "";
  const inItems = formatListItems(proc.inputs);
  const outItems = formatListItems(proc.outputs);
  const inputHtml = inItems.length
    ? `<ul>${inItems.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
    : `<p class="io-empty">No inputs documented yet.</p>`;
  const outputHtml = outItems.length
    ? `<ul>${outItems.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
    : `<p class="io-empty">No outputs documented yet.</p>`;
  return `<div class="diagram-io diagram-io-panel" aria-label="Phase inputs and outputs">
      <div class="diagram-io-col diagram-io-col-inputs">
        <h3>Inputs</h3>
        ${inputHtml}
      </div>
      <div class="diagram-io-col diagram-io-col-outputs">
        <h3>Outputs</h3>
        ${outputHtml}
      </div>
    </div>`;
}

function renderEmptyPhaseDetail() {
  return `<article class="phase-detail phase-detail--empty"><p class="phase-summary">Select a phase in the diagram above to view detail, inputs, and outputs.</p></article>`;
}

function renderPhaseDetail(proc, index, subsByParent) {
  const jp = proc.jp_reference
    ? `<span class="jp-badge">${escapeHtml(proc.jp_reference)}</span>`
    : "";
  const summary = proc.summary
    ? `<p class="phase-summary">${escapeHtml(proc.summary)}</p>`
    : "";
  const panels = renderPanels(proc.legal_analysis, proc.automation_opportunity);
  const subs = renderSubprocesses(subsByParent.get(proc.id) || []);
  return `<article class="phase-detail" data-context-key="${escapeHtml(
    `phase:${proc.id}`
  )}"><header><p class="phase-kicker">Phase ${index}</p><h2>${escapeHtml(
    proc.title || proc.id
  )}</h2>${jp}${summary}</header>${panels}${subs}</article>`;
}

function getContextTexts(ctx) {
  if (!ctx) return { ai: "", legal: "", notes: "" };
  return {
    ai:
      ctx.potential_ai_use_cases ||
      ctx.ai_use_cases ||
      ctx.automation_opportunity ||
      "",
    legal:
      ctx.legal_analysis_processes ||
      ctx.legal_analysis ||
      "",
    notes: ctx.other_notes || ctx.notes || "",
  };
}

function buildContextData(base, prefix) {
  if (!base) return null;
  const p = `${prefix}_`;
  return {
    ...base,
    potential_ai_use_cases:
      base[`${p}potential_ai_use_cases`] ||
      base[`${p}ai_use_cases`] ||
      "",
    legal_analysis_processes:
      base[`${p}legal_analysis_processes`] ||
      base[`${p}legal_analysis`] ||
      "",
    other_notes:
      base[`${p}other_notes`] ||
      base[`${p}notes`] ||
      "",
  };
}

function renderContextPanel(contextLabel, ctx) {
  const texts = getContextTexts(ctx);
  const aiHtml = texts.ai
    ? formatBody(texts.ai)
    : `<p class="io-empty">No data entered for this category.</p>`;
  const legalHtml = texts.legal
    ? formatBody(texts.legal)
    : `<p class="io-empty">No data entered for this category.</p>`;
  const notesHtml = texts.notes
    ? formatBody(texts.notes)
    : `<p class="io-empty">No data entered for this category.</p>`;
  return `<aside class="notes-panel context-panel">
    <p class="phase-kicker">Selected card</p>
    <h3 class="context-title">${escapeHtml(contextLabel || "None selected")}</h3>
    <section class="context-section context-section--ai">
      <h4>Potential AI Use Cases</h4>
      ${aiHtml}
    </section>
    <section class="context-section context-section--legal">
      <h4>Legal analysis/processes</h4>
      ${legalHtml}
      <p class="context-footnote">The above information describes legal analysis/processes that are injected into the targeting process as discussed in the JP 3-60.</p>
    </section>
    <section class="context-section context-section--notes">
      <h4>Other Notes</h4>
      ${notesHtml}
    </section>
  </aside>`;
}

/** Inner connector ring radius in SVG viewBox units (center 500,500; viewBox 1000×1000). */
const INNER_RING_VIEWBOX_RADIUS = 255;

/**
 * Arc segments on an inner ring (smaller radius than phase nodes) so connectors
 * sit in the gap between the center hub and the phase blocks, not under them.
 * viewBox coordinates: 0 0 1000 1000, center (500, 500).
 */
function buildCycleConnectorPaths(phaseCount, innerRadius) {
  const cx = 500;
  const cy = 500;
  const n = Math.max(phaseCount, 1);
  const toRad = (deg) => (deg * Math.PI) / 180;
  const paths = [];
  for (let i = 0; i < n; i += 1) {
    const a1 = -90 + (360 / n) * i;
    const a2 = -90 + (360 / n) * ((i + 1) % n);
    const r1 = toRad(a1);
    const r2 = toRad(a2);
    const x1 = cx + innerRadius * Math.cos(r1);
    const y1 = cy + innerRadius * Math.sin(r1);
    const x2 = cx + innerRadius * Math.cos(r2);
    const y2 = cy + innerRadius * Math.sin(r2);
    let delta = a2 - a1;
    if (delta < 0) delta += 360;
    const largeArc = delta > 180 ? 1 : 0;
    const sweep = 1;
    paths.push(
      `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${innerRadius} ${innerRadius} 0 ${largeArc} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}" />`
    );
  }
  return paths.join("\n");
}

/**
 * Phase centers sit on a circle outside the rendered inner ring. Orbit radius is
 * derived from the SVG scale (meet) so boxes stay off the ring at any size.
 */
function layoutCyclePhases(gridEl, phaseCount) {
  const svg = gridEl.querySelector(".cycle-lines");
  if (!svg || phaseCount < 1) return;

  const scale = Math.min(svg.clientWidth, svg.clientHeight) / 1000;
  if (scale <= 0) return;

  const innerRingPx = INNER_RING_VIEWBOX_RADIUS * scale;
  const buttons = gridEl.querySelectorAll(".step-node[data-phase-id]");
  let maxHalfReach = 110;
  buttons.forEach((btn) => {
    const w = btn.offsetWidth || 220;
    const h = btn.offsetHeight || 92;
    const halfDiag = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2);
    if (halfDiag > maxHalfReach) maxHalfReach = halfDiag;
  });

  const ringStrokeSlack = 8;
  const gapFromRing = 10;
  const desiredOrbit = innerRingPx + ringStrokeSlack + gapFromRing + maxHalfReach;
  const gridHalf = Math.min(gridEl.clientWidth, gridEl.clientHeight) / 2;
  const edgeMargin = 10;
  const maxOrbit = Math.max(
    desiredOrbit,
    gridHalf - maxHalfReach - edgeMargin
  );
  const orbitPx = Math.min(maxOrbit, Math.max(desiredOrbit, maxOrbit - 6));
  const phasePositions = [];

  for (let idx = 0; idx < phaseCount; idx += 1) {
    const btn = buttons[idx];
    if (!btn) continue;
    const phaseId = btn.getAttribute("data-phase-id");
    const angleDeg = -90 + (360 / phaseCount) * idx;
    const angle = (angleDeg * Math.PI) / 180;
    let x = Math.cos(angle) * orbitPx;
    let y = Math.sin(angle) * orbitPx;
    // User-requested shaping: middle phases (2-5) tighter vertically,
    // wider horizontally.
    if (phaseCount >= 6 && idx >= 1 && idx <= 4) {
      x *= 1.24;
      y *= 0.68;
    }
    phasePositions[idx] = { x, y, phaseId };
  }

  // Mirror phases 5/6 from phases 2/3 across the vertical axis.
  if (phaseCount >= 6 && phasePositions[1] && phasePositions[2]) {
    phasePositions[4] = {
      x: -phasePositions[2].x,
      y: phasePositions[2].y,
      phaseId: phasePositions[4]?.phaseId || buttons[4]?.getAttribute("data-phase-id") || "",
    };
    phasePositions[5] = {
      x: -phasePositions[1].x,
      y: phasePositions[1].y,
      phaseId: phasePositions[5]?.phaseId || buttons[5]?.getAttribute("data-phase-id") || "",
    };
  }

  // Pull phase 1 inward and mirror phase 4 from phase 1 across center.
  if (phaseCount >= 6 && phasePositions[0] && phasePositions[3]) {
    // Use a lower floor than desiredOrbit so this move is visibly stronger.
    const minTopOrbit = innerRingPx + ringStrokeSlack - 34 + maxHalfReach;
    const topRadius = Math.max(minTopOrbit, orbitPx - 160);
    phasePositions[0] = {
      x: 0,
      y: -topRadius,
      phaseId: phasePositions[0].phaseId,
    };
    phasePositions[3] = {
      x: -phasePositions[0].x,
      y: -phasePositions[0].y,
      phaseId: phasePositions[3].phaseId,
    };
  }

  for (let idx = 0; idx < phaseCount; idx += 1) {
    const btn = buttons[idx];
    const pos = phasePositions[idx];
    if (!btn || !pos) continue;
    btn.style.setProperty("--x", `${pos.x.toFixed(2)}px`);
    btn.style.setProperty("--y", `${pos.y.toFixed(2)}px`);
  }

}

function renderFlowChart(processes, activeId) {
  const p = processes;
  const n = (idx) => p[idx] || null;
  const active = (id) => (activeId && id === activeId ? "is-active" : "");
  const count = Math.max(p.length, 1);
  const estScale = 0.7;
  const estOrbitPx = INNER_RING_VIEWBOX_RADIUS * estScale + 8 + 10 + 118;

  const step = (idx, x, y) => {
    const proc = n(idx);
    if (!proc) return "";
    return `<button class="node step-node ${active(proc.id)}" data-phase-id="${escapeHtml(
      proc.id
    )}" style="--x:${x.toFixed(2)}px;--y:${y.toFixed(2)}px" type="button"><span class="node-num">${
      idx + 1
    }</span><span class="node-title">${escapeHtml(
      proc.title || proc.id
    )}</span></button>`;
  };
  const phaseNodes = p
    .map((_, idx) => {
      const angleDeg = -90 + (360 / count) * idx;
      const angle = (angleDeg * Math.PI) / 180;
      const x = Math.cos(angle) * estOrbitPx;
      const y = Math.sin(angle) * estOrbitPx;
      return step(idx, x, y);
    })
    .join("");

  const connectorPaths = buildCycleConnectorPaths(count, INNER_RING_VIEWBOX_RADIUS);
  const activeProc = activeId ? p.find((proc) => proc.id === activeId) : null;

  return `<section class="flowchart-wrap cycle-wrap" aria-label="Process cycle chart">
    <div class="cycle-grid${activeId ? " is-focused" : ""}" data-active-phase-id="${activeId ? escapeHtml(activeId) : ""}">
      <svg class="flow-lines cycle-lines" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <marker id="cycle-arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
            <path d="M0,0 L10,4 L0,8 Z"></path>
          </marker>
        </defs>
        ${connectorPaths}
      </svg>
      <div class="cycle-core">Targeting cycle</div>
      ${phaseNodes}
      ${activeProc ? renderDiagramIoBlocks(activeProc) : ""}
    </div>
  </section>`;
}

let cycleResizeObserver = null;

export function renderPage(data) {
  const { metadata, processes, subsByParent } = data;
  const title = metadata.title || "Targeting process";
  const subtitle = metadata.subtitle || "Data is sourced from Joint Publication 3-60, Joint Targeting (28 Sept. 2018).";
  const footer = metadata.footer_note || "";

  document.getElementById("app-title").textContent = title;
  document.getElementById("app-subtitle").textContent = subtitle;
  document.getElementById("app-footer-note").textContent = footer;

  const main = document.getElementById("main-content");
  if (!processes.length) {
    main.innerHTML = `<p>No process data found in targeting-data.txt.</p>`;
    return;
  }

  let activeId = processes[0].id;
  let selectedContextKey = `phase:${activeId}`;

  function shouldClearSelectionOnClick(target) {
    if (!target || !target.closest) return false;
    if (target.closest("button.step-node")) return false;
    if (target.closest("a")) return false;
    if (target.closest("input")) return false;
    if (target.closest("label")) return false;
    if (target.closest(".load-banner")) return false;
    if (target.closest(".diagram-io-panel")) return false;
    if (target.closest(".detail-layout")) return false;
    return true;
  }

  function paint() {
    if (cycleResizeObserver) {
      cycleResizeObserver.disconnect();
      cycleResizeObserver = null;
    }

    const activeIndex = activeId ? processes.findIndex((p) => p.id === activeId) : -1;
    const active = activeIndex >= 0 ? processes[activeIndex] : null;
    const activeSubs = active ? subsByParent.get(active.id) || [] : [];

    const contextIndex = new Map();
    if (active) {
      contextIndex.set(`phase:${active.id}`, { label: active.title || "Phase", data: active });
      activeSubs.forEach((sub) => {
        contextIndex.set(`subprocess:${sub.id}`, { label: sub.title || "Sub-process", data: sub });
        contextIndex.set(`subprocess-inputs:${sub.id}`, {
          label: `${sub.title || "Sub-process"} — Inputs`,
          data: buildContextData(sub, "inputs"),
        });
        contextIndex.set(`subprocess-outputs:${sub.id}`, {
          label: `${sub.title || "Sub-process"} — Outputs`,
          data: buildContextData(sub, "outputs"),
        });
        contextIndex.set(`subprocess-steps:${sub.id}`, {
          label: `${sub.title || "Sub-process"} — Steps`,
          data: buildContextData(sub, "steps"),
        });
        (sub.step_items || []).forEach((step, idx) => {
          contextIndex.set(`step:${step.id}`, {
            label: `${sub.title || "Sub-process"} — Step ${idx + 1}`,
            data: step,
          });
        });
      });
    }
    if (selectedContextKey && !contextIndex.has(selectedContextKey) && active) {
      selectedContextKey = `phase:${active.id}`;
    }
    const selectedContext = selectedContextKey
      ? contextIndex.get(selectedContextKey) || null
      : null;

    main.innerHTML = `
      ${renderFlowChart(processes, activeId)}
      <section class="detail-layout">
        ${active ? renderPhaseDetail(active, activeIndex + 1, subsByParent) : renderEmptyPhaseDetail()}
        ${renderContextPanel(selectedContext?.label || "", selectedContext?.data || null)}
      </section>
    `;
    main.querySelectorAll("[data-phase-id]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        activeId = el.getAttribute("data-phase-id") || activeId;
        selectedContextKey = activeId ? `phase:${activeId}` : null;
        paint();
      });
    });
    main.querySelectorAll("[data-context-key]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const key = el.getAttribute("data-context-key");
        selectedContextKey = selectedContextKey === key ? null : key;
        paint();
      });
    });
    const detailSection = main.querySelector(".detail-layout");
    if (detailSection) {
      detailSection.addEventListener("click", (e) => {
        if (!e.target.closest("[data-context-key]") && !e.target.closest("[data-phase-id]")) {
          selectedContextKey = null;
          paint();
        }
      });
    }
    main.querySelectorAll("[data-context-key]").forEach((el) => {
      const isSelected =
        selectedContextKey &&
        el.getAttribute("data-context-key") === selectedContextKey;
      el.classList.toggle("is-selected", Boolean(isSelected));
    });

    const grid = main.querySelector(".cycle-grid");
    if (grid) {
      const relayout = () => layoutCyclePhases(grid, processes.length);
      requestAnimationFrame(relayout);
      cycleResizeObserver = new ResizeObserver(relayout);
      cycleResizeObserver.observe(grid);
    }
  }

  const pageEl = document.querySelector(".page");
  if (pageEl && !pageEl.dataset.deselectBound) {
    pageEl.dataset.deselectBound = "1";
    pageEl.addEventListener("click", (e) => {
      if (!shouldClearSelectionOnClick(e.target)) return;
      activeId = null;
      selectedContextKey = null;
      paint();
    });
  }

  paint();
}

const DATA_FILE = "targeting_process.txt";

export async function loadDataFromUrl() {
  const res = await fetch(DATA_FILE, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function loadDataFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function showLoadBanner(show) {
  const el = document.getElementById("load-banner");
  if (!el) return;
  el.classList.toggle("is-visible", show);
}
