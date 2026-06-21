import React, { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   ZERO-TO-ONE BUILDER
   A guided reasoning system, not a chatbot.
   5-stage pipeline: Clarify -> Analysis -> Risk -> Perspectives -> Path
   ============================================================ */

// ---------- Design tokens (from brief) ----------
const T = {
  canvas: "#080C1A",
  surface: "#0F1528",
  card: "#131929",
  border: "#1F2844",
  accent: "#4F6EF7",
  text: "#C8CEEA",
  white: "#EEF0FA",
  muted: "#6472A0",
  success: "#34D399",
  warning: "#F59E0B",
  danger: "#F87171",
  gold: "#FBBF24",
};

const FONTS_LINK = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";

const STAGES = [
  { id: 0, key: "clarify", label: "Clarify", short: "Clarify the idea" },
  { id: 1, key: "analysis", label: "Analysis", short: "Understand the shape of it" },
  { id: 2, key: "risk", label: "Risk", short: "Assumptions & confidence" },
  { id: 3, key: "perspectives", label: "Perspectives", short: "Four honest viewpoints" },
  { id: 4, key: "path", label: "Path", short: "Compare paths, pick one" },
];

// ---------- Groq API call (direct from browser — requires VITE_GROQ_API_KEY in your .env) ----------
async function callGroq(systemPrompt, userPrompt, { json = true, maxTokens = 3000 } = {}) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  if (!json) return text;
  let cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  try { return JSON.parse(match ? match[1] : cleaned); }
  catch { throw new Error("Could not parse model response as JSON"); }
}

// ---------- Persistence ----------
function loadState() {
  try {
    const raw = window.__z2o_memory;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveState(state) {
  try {
    window.__z2o_memory = JSON.stringify(state);
  } catch {}
}

// ---------- Prompt builders ----------
function buildContext(intake, answers) {
  let ctx = `IDEA: ${intake.idea}\n`;
  if (intake.goal) ctx += `GOAL: ${intake.goal}\n`;
  if (intake.budget) ctx += `BUDGET: ${intake.budget}\n`;
  if (intake.skills) ctx += `SKILLS: ${intake.skills}\n`;
  if (intake.constraints) ctx += `CONSTRAINTS: ${intake.constraints}\n`;
  if (answers && answers.length) {
    ctx += `\nCLARIFYING CONTEXT:\n`;
    answers.forEach((a) => {
      ctx += `Q: ${a.question}\nA: ${a.answer}\n`;
    });
  }
  return ctx;
}

const SYS_BASE = `You are a precise, honest strategic analyst helping a person turn an early idea into a concrete plan. You are not a chatbot — you produce structured reasoning artifacts. Always respond with ONLY valid JSON, no markdown fences, no preamble, no commentary outside the JSON object. Be specific to the user's actual idea, never generic. Where uncertain, say so explicitly rather than inventing false confidence. Keep all text concise: this will render in a compact UI.

Whenever you are asked for "reasoning_steps": these are shown to the user under a "Why this conclusion" disclosure, so their entire purpose is to explain WHY you landed on the specific numbers/labels/scores you gave above — not a restated to-do list or action plan. Each step must name a concrete input (something the user said, or a fact about their idea) and the inference drawn from it, in plain language a non-technical person would understand on first read. Bad example: "Determine hourly rate and required hours." Good example: "Because you said you have all week and want $2000 in 3 months, that works out to roughly $X/week — which is why the resource score above sits where it does, not higher."`;

async function runClarify(intake) {
  const sys = SYS_BASE;
  const user = `${buildContext(intake)}
Generate up to 3 clarifying questions that would meaningfully change the analysis if answered. For each, explain briefly why it matters. If the idea is already clear and well-specified, return fewer questions or an empty array — do not invent questions for the sake of it.

Return JSON exactly in this shape:
{
  "questions": [
    {"id": "q1", "question": "...", "why_it_matters": "..."}
  ]
}`;
  return callGroq(sys, user);
}

async function runAnalysis(intake, answers) {
  const sys = SYS_BASE;
  const user = `${buildContext(intake, answers)}
Analyze this idea. Be concrete and specific to what was actually described.

Return JSON exactly in this shape:
{
  "summary": "1-2 sentence summary",
  "problem": "the real problem being solved",
  "target_user": "the specific person who would pay for or hire into this — if it's a service/freelance idea, describe who would actually hire the user, not a generic persona",
  "value_proposition": "why this, why now",
  "category": "short category label",
  "core_goal": "the user's stated core goal, sharpened",
  "biggest_constraint": "the single biggest constraint",
  "skills_detected": ["skill1", "skill2"],
  "budget_assessment": "honest read on whether budget matches ambition",
  "scores": {
    "ambition": {"value": 0-100, "label": "short label"},
    "resource": {"value": 0-100, "label": "short label"},
    "reality_gap": {"value": 0-100, "label": "short label, higher = bigger gap between ambition and resources"}
  },
  "reasoning_steps": ["step 1", "step 2", "step 3"]
}`;
  return callGroq(sys, user);
}

async function runRisk(intake, answers, analysis) {
  const sys = SYS_BASE;
  const user = `${buildContext(intake, answers)}
PRIOR ANALYSIS: ${JSON.stringify(analysis)}

Generate exactly 4 assumptions this idea depends on, and an honest confidence assessment. This stage exists to represent uncertainty honestly — do not inflate confidence, and do not hide weak evidence.

Return JSON exactly in this shape:
{
  "assumptions": [
    {"assumption": "...", "why_it_matters": "...", "risk_level": "Low|Medium|High", "impact_if_false": "...", "evidence_strength": "Weak|Moderate|Strong", "validation_priority": 1-4}
  ],
  "biggest_risk": "which assumption and why",
  "highest_priority_assumption": "which one to validate first",
  "confidence": {
    "market_validation": 0-100,
    "customer_evidence": 0-100,
    "technical_certainty": 0-100,
    "execution_clarity": 0-100,
    "competitive_understanding": 0-100,
    "overall_score": 0-100,
    "overall_label": "short honest label, e.g. 'Early and unproven'",
    "explanations": {
      "market_validation": "ONE short plain-language sentence: why this exact score, referencing something specific from the idea/answers",
      "customer_evidence": "ONE short plain-language sentence, same rule",
      "technical_certainty": "ONE short plain-language sentence, same rule",
      "execution_clarity": "ONE short plain-language sentence, same rule",
      "competitive_understanding": "ONE short plain-language sentence, same rule"
    }
  },
  "evidence_factors": [
    {"factor": "...", "weight": 0-1, "score": 0-100, "contribution": 0-100}
  ],
  "reasons_confidence_is_limited": ["reason 1", "reason 2"],
  "missing_information": ["what we don't know"],
  "evidence_needed_next": "single most useful next evidence to gather",
  "reasoning_steps": ["step 1", "step 2", "step 3"]
}`;
  return callGroq(sys, user, { maxTokens: 2800 });
}

async function runPerspectives(intake, answers, analysis, risk) {
  const sys = SYS_BASE;
  const user = `${buildContext(intake, answers)}
PRIOR ANALYSIS: ${JSON.stringify(analysis)}
PRIOR RISK ASSESSMENT: ${JSON.stringify({ assumptions: risk.assumptions, confidence: risk.confidence })}

Generate four genuinely distinct perspectives on this idea. They should actually disagree where a real founder, investor, engineer, and customer would disagree — do not make them all politely agree. Each should reference something specific about this idea, not generic startup advice.

Return JSON exactly in this shape:
{
  "perspectives": [
    {"role": "Founder", "stance": "Optimistic", "take": "2-3 sentences, specific to this idea", "key_point": "one-line takeaway"},
    {"role": "Investor", "stance": "Skeptical", "take": "...", "key_point": "..."},
    {"role": "Engineer", "stance": "Pragmatic", "take": "...", "key_point": "..."},
    {"role": "Customer", "stance": "Critical", "take": "...", "key_point": "..."}
  ],
  "sharpest_disagreement": "1-2 sentences naming where two perspectives genuinely conflict, and why that conflict matters",
  "reasoning_steps": ["step 1", "step 2", "step 3"]
}`;
  return callGroq(sys, user);
}

async function runPath(intake, answers, analysis, risk, perspectives) {
  const sys = SYS_BASE;
  const user = `${buildContext(intake, answers)}
PRIOR ANALYSIS: ${JSON.stringify({ summary: analysis.summary, biggest_constraint: analysis.biggest_constraint, scores: analysis.scores })}
PRIOR RISK: ${JSON.stringify({ biggest_risk: risk.biggest_risk, highest_priority_assumption: risk.highest_priority_assumption, overall: risk.confidence?.overall_label })}
PRIOR PERSPECTIVES: ${JSON.stringify(perspectives.perspectives?.map(p => p.key_point))}

Generate exactly 3 distinct execution paths, then ONE first experiment that tests the riskiest assumption with the smallest possible effort. Then score the 3 paths against 4 decision criteria you define yourself, specific to this idea (e.g. speed of learning, cost, alignment with stated skills, alignment with goal). Frame the result as input to the user's decision, not as a verdict — the user decides, you inform.

Return JSON exactly in this shape:
{
  "paths": [
    {
      "name": "...", "description": "...", "estimated_cost": "...", "estimated_time": "...",
      "risk_level": "Low|Medium|High", "learning_speed": "Slow|Moderate|Fast",
      "likelihood_of_reaching_users": "Low|Medium|High",
      "biggest_advantage": "...", "biggest_disadvantage": "...", "biggest_bet": "..."
    }
  ],
  "experiment": {
    "name": "...", "hypothesis": "...", "exact_actions": ["action 1", "action 2"],
    "success_metric": "...", "evidence_generated": "...", "what_not_to_build_yet": "...",
    "reason": "...", "uncertainty_statement": "honest statement of what this experiment cannot tell you",
    "limitations": "..."
  },
  "decision_criteria": [
    {"name": "...", "weight": 0-1, "rationale": "..."}
  ],
  "scores": {
    "path_0": {"criterion_0": 0-10, "criterion_1": 0-10, "criterion_2": 0-10, "criterion_3": 0-10, "weighted_total": 0-10},
    "path_1": {"criterion_0": 0-10, "criterion_1": 0-10, "criterion_2": 0-10, "criterion_3": 0-10, "weighted_total": 0-10},
    "path_2": {"criterion_0": 0-10, "criterion_1": 0-10, "criterion_2": 0-10, "criterion_3": 0-10, "weighted_total": 0-10}
  },
  "highest_scoring_path_index": 0,
  "informational_note": "1-2 sentences framing the highest score as an input, not an answer",
  "what_would_change_this": "what new evidence would change which path looks best",
  "reasoning_steps": ["step 1", "step 2", "step 3"]
}`;
  return callGroq(sys, user, { maxTokens: 3500 });
}

// ---------- Small UI primitives ----------
function RadialGauge({ value, label, color, size = 116 }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(value), 80);
    return () => clearTimeout(t);
  }, [value]);
  const offset = c - (animated / 100) * c;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.border} strokeWidth={8} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1)", filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div style={{ marginTop: -size + size / 2 - 14, fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 600, color: T.white }}>
        {Math.round(animated)}
      </div>
      <div style={{ fontSize: 12.5, color: T.muted, textAlign: "center", maxWidth: size + 20, marginTop: size / 2 - 6 }}>{label}</div>
    </div>
  );
}

function Bar({ label, value, sub, color = T.accent, explain }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(value), 80);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
        <span style={{ color: T.text }}>{label}</span>
        <span style={{ color: T.muted, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{sub || `${value}`}</span>
      </div>
      <div style={{ height: 7, background: T.surface, borderRadius: 5, border: `1px solid ${T.border}`, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${w}%`, background: `linear-gradient(90deg, ${color}aa, ${color})`, borderRadius: 5, transition: "width 1s cubic-bezier(.22,1,.36,1)" }} />
      </div>
      {explain && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 5, lineHeight: 1.5, textAlign: "left" }}>{explain}</div>}
    </div>
  );
}

function Badge({ children, tone = "default" }) {
  const tones = {
    default: { bg: T.surface, fg: T.text, bd: T.border },
    danger: { bg: "#2A1518", fg: T.danger, bd: "#4a2228" },
    warning: { bg: "#2A2012", fg: T.warning, bd: "#4a3a1a" },
    success: { bg: "#10261c", fg: T.success, bd: "#1d4434" },
    gold: { bg: "#2a230f", fg: T.gold, bd: "#4a3e1a" },
  };
  const s = tones[tone] || tones.default;
  return (
    <span style={{
      display: "inline-block", fontSize: 11.5, padding: "3px 10px", borderRadius: 20,
      background: s.bg, color: s.fg, border: `1px solid ${s.bd}`, fontWeight: 600, letterSpacing: 0.3,
      whiteSpace: "nowrap", flexShrink: 0,
    }}>{children}</span>
  );
}

function riskTone(level) {
  if (!level) return "default";
  const l = level.toLowerCase();
  if (l === "high") return "danger";
  if (l === "medium" || l === "moderate") return "warning";
  if (l === "low" || l === "strong") return "success";
  return "default";
}

function evidenceCaption(level) {
  if (!level) return "";
  const l = level.toLowerCase();
  if (l === "weak") return "Nothing has actually confirmed this yet — it's closer to a guess than a fact right now.";
  if (l === "moderate") return "There's some indirect signal pointing this way, but it hasn't been directly tested.";
  if (l === "strong") return "This has already been directly tested or confirmed, not just assumed.";
  return "";
}

function Card({ children, style, glow }) {
  const [hover, setHover] = useState(false);
  const baseShadow = glow ? `0 0 0 1px ${T.border}, 0 18px 50px -16px ${glow}` : `0 12px 30px -18px rgba(0,0,0,0.6)`;
  const hoverShadow = `0 26px 60px -18px rgba(0,0,0,0.65), 0 0 0 1px ${T.accent}40`;
  return (
    <div
      className="z2o-card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? "rgba(22,28,46,0.72)" : T.card,
        border: `1px solid ${T.border}`, borderRadius: 16, padding: 24,
        boxShadow: hover ? hoverShadow : baseShadow,
        transform: hover ? "translateY(-4px) scale(1.015)" : "translateY(0) scale(1)",
        backdropFilter: hover ? "blur(14px) saturate(150%)" : "none",
        WebkitBackdropFilter: hover ? "blur(14px) saturate(150%)" : "none",
        transition: "transform .25s cubic-bezier(.22,1,.36,1), box-shadow .25s ease, background-color .25s ease, backdrop-filter .25s ease",
        ...style,
      }}
    >{children}</div>
  );
}

function SectionTitle({ eyebrow, title, sub, purpose }) {
  return (
    <div style={{ marginBottom: 28, textAlign: "center" }}>
      {eyebrow && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: T.accent, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>{eyebrow}</div>}
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 600, color: T.white, margin: 0, lineHeight: 1.25 }}>{title}</h2>
      {sub && <p style={{ color: T.muted, fontSize: 14.5, marginTop: 10, lineHeight: 1.6, maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>{sub}</p>}
      {purpose && (
        <p style={{
          color: T.text, fontSize: 13, marginTop: 14, lineHeight: 1.65, maxWidth: 600,
          marginLeft: "auto", marginRight: "auto", padding: "10px 16px",
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
        }}>{purpose}</p>
      )}
    </div>
  );
}

function ReasoningDisclosure({ steps }) {
  const [open, setOpen] = useState(false);
  if (!steps || !steps.length) return null;
  return (
    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <button onClick={() => setOpen(!open)} style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, fontSize: 12.5, cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
        transition: "border-color .15s, color .15s",
      }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.color = T.white; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.text; }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .2s", display: "inline-block", fontSize: 10, color: T.accent }}>▸</span>
        Why this conclusion
      </button>
      {open && (
        <div style={{ marginTop: 12, width: "100%", maxWidth: 600, textAlign: "left" }}>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 10, lineHeight: 1.6 }}>
            The reasoning chain that produced the conclusions above — each step is a "because → so" link, not a list of next actions.
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, color: T.text, fontSize: 13, lineHeight: 1.8, textAlign: "left" }}>
            {steps.map((s, i) => <li key={i} style={{ marginBottom: 6 }}>{s}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

function ErrorBlock({ message, onRetry }) {
  return (
    <Card style={{ borderColor: "#4a2228" }}>
      <div style={{ color: T.danger, fontSize: 14, marginBottom: 12, fontWeight: 600 }}>This stage didn't complete.</div>
      <div style={{ color: T.muted, fontSize: 13, marginBottom: 16 }}>{message || "The model response could not be processed."}</div>
      <button onClick={onRetry} style={btnPrimary}>Retry this stage</button>
    </Card>
  );
}

function Loader({ text }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", gap: 18 }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%", border: `2.5px solid ${T.border}`,
        borderTopColor: T.accent, animation: "z2o-spin 0.9s linear infinite",
      }} />
      <div style={{ color: T.muted, fontSize: 13.5, fontFamily: "'JetBrains Mono', monospace" }}>{text}</div>
    </div>
  );
}

const btnPrimary = {
  background: T.accent, color: T.white, border: "none", borderRadius: 10,
  padding: "12px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer",
  fontFamily: "'DM Sans', sans-serif", boxShadow: `0 8px 24px -8px ${T.accent}88`,
  transition: "transform .15s, box-shadow .15s",
};
const btnGhost = {
  background: "transparent", color: T.text, border: `1px solid ${T.border}`, borderRadius: 10,
  padding: "11px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
};

// ---------- Responsible AI strip ----------
function ResponsibleAIStrip({ text }) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 16px",
      background: "rgba(79,110,247,0.06)", border: `1px solid ${T.border}`, borderRadius: 10,
      marginBottom: 24, fontSize: 12.5, color: T.muted, lineHeight: 1.6,
    }}>
      <span style={{ color: T.accent, fontSize: 14, lineHeight: 1 }}></span>
      <span>{text}</span>
    </div>
  );
}

// ---------- Background ambience ----------
function Ambience() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none", background: T.canvas }}>
      <div style={{
        position: "absolute", top: "-10%", left: "-5%", width: "55%", height: "55%",
        background: `radial-gradient(circle, ${T.accent}26 0%, transparent 70%)`, filter: "blur(60px)",
        animation: "z2o-float1 22s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", bottom: "-15%", right: "-10%", width: "60%", height: "60%",
        background: `radial-gradient(circle, ${T.gold}14 0%, transparent 70%)`, filter: "blur(70px)",
        animation: "z2o-float2 26s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `linear-gradient(${T.border}22 1px, transparent 1px), linear-gradient(90deg, ${T.border}22 1px, transparent 1px)`,
        backgroundSize: "44px 44px", opacity: 0.35,
      }} />
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [phase, setPhase] = useState("landing"); // landing | pipeline
  const [intake, setIntake] = useState({ idea: "", goal: "", budget: "", skills: "", constraints: "" });
  const [currentStage, setCurrentStage] = useState(0);
  const [stageStatus, setStageStatus] = useState({}); // {0: 'pending'|'loading'|'success'|'error'}
  const [stageData, setStageData] = useState({});
  const [stageError, setStageError] = useState({});
  const [clarifyAnswers, setClarifyAnswers] = useState([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // restore
  useEffect(() => {
    const saved = loadState();
    if (saved) {
      setPhase(saved.phase || "landing");
      setIntake(saved.intake || intake);
      setCurrentStage(saved.currentStage || 0);
      setStageStatus(saved.stageStatus || {});
      setStageData(saved.stageData || {});
      setClarifyAnswers(saved.clarifyAnswers || []);
    }
  }, []);

  useEffect(() => {
    saveState({ phase, intake, currentStage, stageStatus, stageData, clarifyAnswers });
  }, [phase, intake, currentStage, stageStatus, stageData, clarifyAnswers]);

  const setStatus = (stage, status) => setStageStatus((p) => ({ ...p, [stage]: status }));
  const setData = (stage, data) => setStageData((p) => ({ ...p, [stage]: data }));
  const setErr = (stage, msg) => setStageError((p) => ({ ...p, [stage]: msg }));

  const runStage = useCallback(async (stage) => {
    setStatus(stage, "loading");
    setErr(stage, null);
    const run = () => {
      if (stage === 0) return runClarify(intake);
      if (stage === 1) return runAnalysis(intake, clarifyAnswers);
      if (stage === 2) return runRisk(intake, clarifyAnswers, stageData[1]);
      if (stage === 3) return runPerspectives(intake, clarifyAnswers, stageData[1], stageData[2]);
      if (stage === 4) return runPath(intake, clarifyAnswers, stageData[1], stageData[2], stageData[3]);
      return Promise.reject(new Error("Unknown stage"));
    };
    try {
      const result = await run();
      setData(stage, result);
      setStatus(stage, "success");
    } catch (firstError) {
      // Most failures here are a truncated/malformed JSON response from the model —
      // a silent retry resolves this most of the time without the user lifting a finger.
      try {
        const result = await run();
        setData(stage, result);
        setStatus(stage, "success");
      } catch (secondError) {
        setErr(stage, secondError.message);
        setStatus(stage, "error");
      }
    }
  }, [intake, clarifyAnswers, stageData]);

  // auto-run stage when entering it, if pending
  useEffect(() => {
    if (phase !== "pipeline") return;
    const status = stageStatus[currentStage];
    if (!status || status === "pending") {
      runStage(currentStage);
    }
  }, [phase, currentStage]);

  const startPipeline = () => {
    setPhase("pipeline");
    setCurrentStage(0);
    setStageStatus({});
    setStageData({});
    setClarifyAnswers([]);
  };

  const goToStage = (idx) => {
    if (idx > currentStage && stageStatus[currentStage] !== "success" && idx !== 0) return;
    setCurrentStage(idx);
    setMobileNavOpen(false);
  };

  const advance = () => {
    const next = currentStage + 1;
    if (next < STAGES.length) setCurrentStage(next);
  };

  const startOver = () => {
    setPhase("landing");
    setIntake({ idea: "", goal: "", budget: "", skills: "", constraints: "" });
    setCurrentStage(0);
    setStageStatus({});
    setStageData({});
    setClarifyAnswers([]);
  };

  return (
    <div style={{
      minHeight: "100vh", background: T.canvas, color: T.text,
      fontFamily: "'DM Sans', sans-serif", position: "relative", width: "100%", overflowX: "hidden",
    }}>
      <link rel="stylesheet" href={FONTS_LINK} />
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::selection { background: ${T.accent}55; }
        @keyframes z2o-spin { to { transform: rotate(360deg); } }
        @keyframes z2o-float1 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(30px,40px); } }
        @keyframes z2o-float2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-40px,-30px); } }
        @keyframes z2o-fadeup { from { opacity:0; transform: translateY(14px); } to { opacity:1; transform: translateY(0); } }
        .z2o-fade { animation: z2o-fadeup .5s cubic-bezier(.22,1,.36,1) both; }
        textarea, input { font-family: 'DM Sans', sans-serif; }
        textarea:focus, input:focus, button:focus-visible {
          outline: 2px solid ${T.accent}; outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; }
        }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: ${T.canvas}; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 6px; }
        .z2o-card { will-change: transform; }
        @media (prefers-reduced-motion: reduce) {
          .z2o-card { transition: none !important; }
        }
        ul, ol { text-align: left; }
        .z2o-analysis-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .z2o-perspectives-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
        @media (max-width: 700px) {
          .z2o-analysis-grid { grid-template-columns: 1fr; }
          .z2o-perspectives-grid { grid-template-columns: 1fr; }
        }
      `}</style>
      <Ambience />
      <div style={{ position: "relative", zIndex: 1 }}>
        {phase === "landing" ? (
          <Landing intake={intake} setIntake={setIntake} onStart={startPipeline} />
        ) : (
          <Pipeline
            intake={intake} currentStage={currentStage} stageStatus={stageStatus}
            stageData={stageData} stageError={stageError}
            clarifyAnswers={clarifyAnswers} setClarifyAnswers={setClarifyAnswers}
            goToStage={goToStage} advance={advance} runStage={runStage}
            startOver={startOver} mobileNavOpen={mobileNavOpen} setMobileNavOpen={setMobileNavOpen}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// LANDING
// ============================================================
function Landing({ intake, setIntake, onStart }) {
  const canStart = intake.idea.trim().length >= 12;
  const set = (k) => (e) => setIntake((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 20px" }}>
      <div className="z2o-fade" style={{ width: "100%", maxWidth: 640 }}>
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: T.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>
            Zero → One
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(32px, 5vw, 44px)", fontWeight: 600, color: T.white, margin: 0, lineHeight: 1.2 }}>
            Turn an uncertain idea<br />into a concrete first step.
          </h1>
          <p style={{ color: T.muted, fontSize: 15, marginTop: 16, lineHeight: 1.6, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
            Five stages of structured reasoning — not a chatbot. Each stage builds on the last, ending in a decision you make with full visibility into the tradeoffs.
          </p>
        </div>

        <Card style={{ padding: 32 }}>
          <Field label="Your idea" required>
            <textarea
              value={intake.idea} onChange={set("idea")}
              placeholder="An AI startup, a SaaS product, a hackathon project, a career plan, a side hustle..."
              rows={4}
              style={taStyle}
            />
          </Field>
          <Field label="Goal" optional>
            <input value={intake.goal} onChange={set("goal")} placeholder="Win a hackathon, launch a startup, get first customers..." style={inStyle} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="Budget" optional>
              <input value={intake.budget} onChange={set("budget")} placeholder="$0, $500, $5000..." style={inStyle} />
            </Field>
            <Field label="Skills" optional>
              <input value={intake.skills} onChange={set("skills")} placeholder="React, Python, design..." style={inStyle} />
            </Field>
          </div>
          <Field label="Constraints" optional last>
            <input value={intake.constraints} onChange={set("constraints")} placeholder="Solo founder, limited time, launch deadline..." style={inStyle} />
          </Field>

          <button
            onClick={onStart} disabled={!canStart}
            style={{
              ...btnPrimary, width: "100%", marginTop: 8, padding: "14px 22px", fontSize: 15,
              opacity: canStart ? 1 : 0.4, cursor: canStart ? "pointer" : "not-allowed",
            }}
          >
            Analyze My Idea
          </button>
        </Card>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: T.muted }}>
          This tool informs your thinking. It does not decide for you — see each stage for what stays in your hands.
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, optional, children, last }) {
  return (
    <div style={{ marginBottom: last ? 24 : 18 }}>
      <label style={{ display: "block", fontSize: 12.5, color: T.muted, marginBottom: 7, fontWeight: 500 }}>
        {label} {required && <span style={{ color: T.accent }}>*</span>}
        {optional && <span style={{ color: T.muted, fontWeight: 400 }}> · optional</span>}
      </label>
      {children}
    </div>
  );
}

const inStyle = {
  width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
  padding: "11px 14px", color: T.white, fontSize: 14, outline: "none",
};
const taStyle = { ...inStyle, resize: "vertical", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" };

// ============================================================
// PIPELINE SHELL
// ============================================================
function Pipeline(props) {
  const { currentStage, stageStatus, mobileNavOpen, setMobileNavOpen, goToStage, startOver } = props;
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Desktop rail */}
      <div className="z2o-desktop-rail" style={{
        width: 232, borderRight: `1px solid ${T.border}`, padding: "32px 20px",
        display: "flex", flexDirection: "column", gap: 4, position: "sticky", top: 0, height: "100vh",
      }}>
        <div onClick={startOver} style={{ cursor: "pointer", marginBottom: 32, fontFamily: "'Playfair Display', serif", fontSize: 17, color: T.white, fontWeight: 600 }}>
          Zero → One
        </div>
        {STAGES.map((s) => (
          <RailItem key={s.id} stage={s} status={stageStatus[s.id]} active={currentStage === s.id} onClick={() => goToStage(s.id)} />
        ))}
        <div style={{ marginTop: "auto", fontSize: 11.5, color: T.muted, lineHeight: 1.6, paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
          A reasoning tool. The decision at the end is yours.
        </div>
      </div>

      {/* Mobile top nav */}
      <div className="z2o-mobile-nav" style={{
        display: "none", position: "sticky", top: 0, zIndex: 10, background: `${T.canvas}f2`,
        backdropFilter: "blur(8px)", borderBottom: `1px solid ${T.border}`, padding: "14px 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: mobileNavOpen ? 14 : 0 }}>
          <div onClick={startOver} style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, color: T.white, fontWeight: 600, cursor: "pointer" }}>Zero → One</div>
          <button onClick={() => setMobileNavOpen(!mobileNavOpen)} style={{ ...btnGhost, padding: "7px 14px", fontSize: 12.5 }}>
            {STAGES[currentStage].label} · {currentStage + 1}/5
          </button>
        </div>
        <div style={{ display: mobileNavOpen ? "flex" : "none", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {STAGES.map((s) => (
            <button key={s.id} onClick={() => goToStage(s.id)} style={{
              flexShrink: 0, padding: "7px 13px", borderRadius: 8, fontSize: 12.5,
              border: `1px solid ${currentStage === s.id ? T.accent : T.border}`,
              background: currentStage === s.id ? `${T.accent}22` : "transparent",
              color: currentStage === s.id ? T.white : T.muted, cursor: "pointer",
            }}>
              {stageStatus[s.id] === "success" ? "✓ " : ""}{s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="z2o-content" style={{ flex: 1, padding: "44px 28px 80px", maxWidth: 880, margin: "0 auto", width: "100%" }}>
        <StageRouter {...props} />
      </div>

      <style>{`
        @media (max-width: 880px) {
          .z2o-desktop-rail { display: none; }
          .z2o-mobile-nav { display: block !important; }
        }
        @media (max-width: 520px) {
          .z2o-content { padding: 28px 16px 64px !important; }
          .z2o-card { padding: 18px !important; }
        }
      `}</style>
    </div>
  );
}

function RailItem({ stage, status, active, onClick }) {
  const isDone = status === "success";
  const isLoading = status === "loading";
  const isError = status === "error";
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 10,
      background: active ? `${T.accent}18` : "transparent", border: "none", cursor: "pointer",
      textAlign: "left", width: "100%", marginBottom: 2,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11,
        border: `1.5px solid ${isDone ? T.success : isError ? T.danger : active ? T.accent : T.border}`,
        background: isDone ? `${T.success}22` : "transparent", color: isDone ? T.success : isError ? T.danger : T.muted,
      }}>
        {isDone ? "✓" : isError ? "!" : isLoading ? <span style={{ width: 8, height: 8, borderRadius: "50%", border: `1.5px solid ${T.border}`, borderTopColor: T.accent, animation: "z2o-spin .8s linear infinite", display: "inline-block" }} /> : stage.id + 1}
      </div>
      <div>
        <div style={{ fontSize: 13.5, color: active ? T.white : T.text, fontWeight: active ? 600 : 500 }}>{stage.label}</div>
        <div style={{ fontSize: 11, color: T.muted }}>{stage.short}</div>
      </div>
    </button>
  );
}

function StageRouter(props) {
  const { currentStage } = props;
  if (currentStage === 0) return <StageClarify {...props} />;
  if (currentStage === 1) return <StageAnalysis {...props} />;
  if (currentStage === 2) return <StageRisk {...props} />;
  if (currentStage === 3) return <StagePerspectives {...props} />;
  if (currentStage === 4) return <StagePath {...props} />;
  return null;
}

// ============================================================
// STAGE 0 — CLARIFY
// ============================================================
function StageClarify({ stageStatus, stageData, stageError, runStage, advance, setClarifyAnswers }) {
  const status = stageStatus[0];
  const data = stageData[0];
  const [drafts, setDrafts] = useState({});

  if (status === "loading" || !status) return <Loader text="Reading your idea..." />;
  if (status === "error") return <ErrorBlock message={stageError[0]} onRetry={() => runStage(0)} />;

  const questions = data?.questions || [];

  const submitAnswers = () => {
    const answers = questions.map((q) => ({ question: q.question, answer: drafts[q.id] || "" })).filter((a) => a.answer.trim());
    setClarifyAnswers(answers);
    advance();
  };

  return (
    <div className="z2o-fade">
      <SectionTitle eyebrow="Stage 1 of 5" title="Clarify" sub="A few questions whose answers would actually change the analysis. Skip any that don't apply." purpose="Why this stage: the model can already see gaps in what you typed. Answering helps it reason with real specifics instead of guessing — but nothing here blocks you from moving forward." />
      {questions.length === 0 ? (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ color: T.text, fontSize: 14.5, lineHeight: 1.6 }}>Your idea is specific enough to move straight into analysis — no clarifying questions needed here.</div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
          {questions.map((q) => (
            <Card key={q.id}>
              <div style={{ fontSize: 15, color: T.white, fontWeight: 600, marginBottom: 6 }}>{q.question}</div>
              <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 14 }}>{q.why_it_matters}</div>
              <textarea
                value={drafts[q.id] || ""}
                onChange={(e) => setDrafts((p) => ({ ...p, [q.id]: e.target.value }))}
                placeholder="Your answer (optional)..." rows={2} style={taStyle}
              />
            </Card>
          ))}
        </div>
      )}
      <ResponsibleAIStrip text="These questions shape the analysis but don't gate it — you can continue without answering, and the model will reason with what's available." />
      <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "center" }}>
        <button onClick={submitAnswers} style={btnPrimary}>Continue to Analysis</button>
      </div>
    </div>
  );
}

// ============================================================
// STAGE 1 — ANALYSIS
// ============================================================
function StageAnalysis({ stageStatus, stageData, stageError, runStage, advance }) {
  const status = stageStatus[1];
  const data = stageData[1];
  if (status === "loading" || !status) return <Loader text="Mapping the shape of the idea..." />;
  if (status === "error") return <ErrorBlock message={stageError[1]} onRetry={() => runStage(1)} />;
  if (!data) return null;

  const scores = data.scores || {};
  return (
    <div className="z2o-fade">
      <SectionTitle eyebrow="Stage 2 of 5" title="Idea Analysis" sub={data.summary} purpose="Why this stage: before judging risk or comparing paths, the model maps the basic shape of your idea — the problem, the user, and whether your ambition matches your actual resources. This is the foundation everything after it builds on." />

      <div className="z2o-analysis-grid" style={{ marginBottom: 20 }}>
        <InfoCard label="Problem" value={data.problem} hint="What's actually standing in the way of the goal" />
        <InfoCard label="Target user" value={data.target_user} hint="Who you'd be doing this for — the person who pays or hires you" />
        <InfoCard label="Value proposition" value={data.value_proposition} hint="Why someone picks this over the alternative" />
        <InfoCard label="Category" value={data.category} full />
      </div>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: T.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 20, textAlign: "center" }}>Idea scores</div>
        <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 24, marginBottom: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11, color: T.accent, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Ambition</div>
            <RadialGauge value={scores.ambition?.value || 0} label={scores.ambition?.label || "How bold is this idea"} color={T.accent} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11, color: T.success, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Resources</div>
            <RadialGauge value={scores.resource?.value || 0} label={scores.resource?.label || "Budget + skills fit"} color={T.success} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11, color: T.warning, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Reality Gap</div>
            <RadialGauge value={scores.reality_gap?.value || 0} label={scores.reality_gap?.label || "Higher = bigger gap"} color={T.warning} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11.5, color: T.muted }}><span style={{ color: T.accent }}>●</span> Ambition — how big the idea is</div>
          <div style={{ fontSize: 11.5, color: T.muted }}><span style={{ color: T.success }}>●</span> Resources — how well-equipped you are</div>
          <div style={{ fontSize: 11.5, color: T.muted }}><span style={{ color: T.warning }}>●</span> Reality gap — mismatch between the two</div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 16, marginBottom: 20 }}>
        <Card>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Biggest constraint</div>
          <div style={{ fontSize: 14, color: T.text, lineHeight: 1.6 }}>{data.biggest_constraint}</div>
        </Card>
        <Card>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Budget assessment</div>
          <div style={{ fontSize: 14, color: T.text, lineHeight: 1.6 }}>{data.budget_assessment}</div>
        </Card>
      </div>

      {data.skills_detected?.length > 0 && (
        <div style={{ marginBottom: 20, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {data.skills_detected.map((s, i) => <Badge key={i}>{s}</Badge>)}
        </div>
      )}

      <ReasoningDisclosure steps={data.reasoning_steps} />
      <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
        <button onClick={advance} style={btnPrimary}>Continue to Risk Assessment</button>
      </div>
    </div>
  );
}

function InfoCard({ label, value, full, hint }) {
  return (
    <Card style={full ? { gridColumn: "1 / -1" } : undefined}>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: hint ? 2 : 8, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: T.muted, fontStyle: "italic", marginBottom: 8 }}>{hint}</div>}
      <div style={{ fontSize: 14.5, color: T.white, lineHeight: 1.55 }}>{value}</div>
    </Card>
  );
}

// ============================================================
// STAGE 2 — RISK (Assumptions + Confidence merged)
// ============================================================
function StageRisk({ stageStatus, stageData, stageError, runStage, advance }) {
  const status = stageStatus[2];
  const data = stageData[2];
  if (status === "loading" || !status) return <Loader text="Stress-testing the assumptions..." />;
  if (status === "error") return <ErrorBlock message={stageError[2]} onRetry={() => runStage(2)} />;
  if (!data) return null;

  const c = data.confidence || {};
  return (
    <div className="z2o-fade">
      <SectionTitle eyebrow="Stage 3 of 5" title="Assumptions & Confidence" sub="What this idea depends on being true, and how much evidence currently backs that up." purpose="Why this stage: every plan secretly rests on a few unproven beliefs. Naming them here — and scoring how solid the evidence is — tells you which parts of your plan are facts and which are still bets, so you know what to go test first." />

      <ResponsibleAIStrip text={`Risk: confidence scores can create false certainty if taken at face value. Mitigation: every score here is paired with what's missing — read the gaps, not just the number.`} />

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
        {(data.assumptions || []).map((a, i) => (
          <Card key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 14.5, color: T.white, fontWeight: 600, lineHeight: 1.4 }}>{a.assumption}</div>
              <Badge tone={riskTone(a.risk_level)}>{a.risk_level} risk</Badge>
            </div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 10, lineHeight: 1.6 }}>{a.why_it_matters}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12.5 }}>
              <div><span style={{ color: T.muted }}>If this turns out wrong: </span><span style={{ color: T.text }}>{a.impact_if_false}</span></div>
              <div>
                <div><span style={{ color: T.muted }}>Evidence so far: </span><Badge tone={riskTone(a.evidence_strength)}>{a.evidence_strength}</Badge></div>
                <div style={{ fontSize: 11.5, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>{evidenceCaption(a.evidence_strength)}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 16, marginBottom: 24 }}>
        <Card style={{ borderColor: T.danger + "44" }}>
          <div style={{ fontSize: 12, color: T.danger, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Biggest risk</div>
          <div style={{ fontSize: 14, color: T.text, lineHeight: 1.6 }}>{data.biggest_risk}</div>
        </Card>
        <Card style={{ borderColor: T.gold + "44" }}>
          <div style={{ fontSize: 12, color: T.gold, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Validate first</div>
          <div style={{ fontSize: 14, color: T.text, lineHeight: 1.6 }}>{data.highest_priority_assumption}</div>
        </Card>
      </div>

      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: T.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Overall confidence</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: T.white, fontSize: 22, fontWeight: 600 }}>{c.overall_score ?? "—"}<span style={{ fontSize: 13, color: T.muted }}>/100</span></div>
        </div>
        <div style={{ fontSize: 13.5, color: T.text, marginBottom: 18, fontStyle: "italic" }}>"{c.overall_label}"</div>
        <Bar label="Market validation" value={c.market_validation || 0} color={T.accent} explain={c.explanations?.market_validation} />
        <Bar label="Customer evidence" value={c.customer_evidence || 0} color={T.accent} explain={c.explanations?.customer_evidence} />
        <Bar label="Technical certainty" value={c.technical_certainty || 0} color={T.accent} explain={c.explanations?.technical_certainty} />
        <Bar label="Execution clarity" value={c.execution_clarity || 0} color={T.accent} explain={c.explanations?.execution_clarity} />
        <Bar label="Competitive understanding" value={c.competitive_understanding || 0} color={T.accent} explain={c.explanations?.competitive_understanding} />
      </Card>

      {data.evidence_factors?.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: T.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 16 }}>Weighted evidence factors</div>
          {data.evidence_factors.map((f, i) => (
            <Bar key={i} label={f.factor} value={f.contribution} sub={`weight ${f.weight} · score ${f.score}`} color={T.gold} />
          ))}
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 16, marginBottom: 8 }}>
        <Card>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Why confidence is limited</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: T.text, lineHeight: 1.7 }}>
            {(data.reasons_confidence_is_limited || []).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </Card>
        <Card>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>What's missing</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: T.text, lineHeight: 1.7 }}>
            {(data.missing_information || []).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </Card>
      </div>

      <ReasoningDisclosure steps={data.reasoning_steps} />
      <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
        <button onClick={advance} style={btnPrimary}>Continue to Perspectives</button>
      </div>
    </div>
  );
}

// ============================================================
// STAGE 3 — PERSPECTIVES
// ============================================================
function StagePerspectives({ stageStatus, stageData, stageError, runStage, advance }) {
  const status = stageStatus[3];
  const data = stageData[3];
  if (status === "loading" || !status) return <Loader text="Gathering four honest opinions..." />;
  if (status === "error") return <ErrorBlock message={stageError[3]} onRetry={() => runStage(3)} />;
  if (!data) return null;

  const colors = { Founder: T.success, Investor: T.warning, Engineer: T.accent, Customer: T.danger };

  return (
    <div className="z2o-fade">
      <SectionTitle eyebrow="Stage 4 of 5" title="Multi-Perspective Debate" sub="Four viewpoints that don't have to agree with each other." purpose="Why this stage: a founder, an investor, an engineer, and a customer would each poke at this idea differently — and disagree with each other. Seeing those four takes side by side surfaces blind spots no single viewpoint (including your own) would catch alone." />

      <div className="z2o-perspectives-grid" style={{ marginBottom: 20 }}>
        {(data.perspectives || []).map((p, i) => (
          <Card key={i} glow={`${colors[p.role] || T.accent}22`} style={{ borderTop: `2.5px solid ${colors[p.role] || T.accent}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 17, color: T.white, fontWeight: 600 }}>{p.role}</div>
              <Badge>{p.stance}</Badge>
            </div>
            <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.65, marginBottom: 12 }}>{p.take}</div>
            <div style={{ fontSize: 12.5, color: colors[p.role] || T.accent, fontWeight: 600 }}>{p.key_point}</div>
          </Card>
        ))}
      </div>

      {data.sharpest_disagreement && (
        <Card style={{ marginBottom: 20, borderColor: T.gold + "44" }}>
          <div style={{ fontSize: 12, color: T.gold, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Where they genuinely disagree</div>
          <div style={{ fontSize: 14, color: T.text, lineHeight: 1.6 }}>{data.sharpest_disagreement}</div>
        </Card>
      )}

      <ReasoningDisclosure steps={data.reasoning_steps} />
      <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
        <button onClick={advance} style={btnPrimary}>Continue to Path Comparison</button>
      </div>
    </div>
  );
}

// ============================================================
// STAGE 4 — PATH (Execution Paths + Experiment + Decision)
// ============================================================
function StagePath({ stageStatus, stageData, stageError, runStage, startOver }) {
  const status = stageStatus[4];
  const data = stageData[4];
  const [userChoice, setUserChoice] = useState(null);

  if (status === "loading" || !status) return <Loader text="Comparing paths and designing the first experiment..." />;
  if (status === "error") return <ErrorBlock message={stageError[4]} onRetry={() => runStage(4)} />;
  if (!data) return null;

  const paths = data.paths || [];
  const exp = data.experiment || {};
  const criteria = data.decision_criteria || [];
  const scores = data.scores || {};
  const highestIdx = data.highest_scoring_path_index ?? 0;

  return (
    <div className="z2o-fade">
      <SectionTitle eyebrow="Stage 5 of 5" title="Execution Paths" sub="Three ways forward, compared honestly — plus the smallest experiment that tests what matters most." purpose="Why this stage: this turns everything above into something you can act on — three concrete routes, scored against criteria built for your specific goal, and one small experiment to test the riskiest assumption first. The scores are an input you can weigh; the choice at the end is yours." />

      <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 16, textAlign: "center" }}>
        Each card below ends with its biggest <span style={{ color: T.success }}>strength</span>, biggest <span style={{ color: T.danger }}>weakness</span>, and its biggest <span style={{ color: T.gold }}>open bet</span> — the one thing about that path nobody can be sure of yet.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 16, marginBottom: 28 }}>
        {paths.map((p, i) => (
          <Card key={i} style={{ border: i === highestIdx ? `1.5px solid ${T.accent}` : `1px solid ${T.border}` }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 17, color: T.white, fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, lineHeight: 1.6 }}>{p.description}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, marginBottom: 12 }}>
              <Meta label="Cost" value={p.estimated_cost} />
              <Meta label="Time" value={p.estimated_time} />
              <Meta label="Risk" value={p.risk_level} badge />
              <Meta label="Learning speed" value={p.learning_speed} />
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.7, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: T.success, fontWeight: 700 }}>+ Strength: </span>
                <span style={{ color: T.text }}>{p.biggest_advantage}</span>
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: T.danger, fontWeight: 700 }}>− Weakness: </span>
                <span style={{ color: T.text }}>{p.biggest_disadvantage}</span>
              </div>
              <div>
                <span style={{ color: T.gold, fontWeight: 700 }}>? Open bet: </span>
                <span style={{ color: T.text }}>{p.biggest_bet}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ marginBottom: 28, borderColor: T.accent + "44" }}>
        <div style={{ fontSize: 12, color: T.accent, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>First experiment</div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: T.white, fontWeight: 600, marginBottom: 8 }}>{exp.name}</div>
        <div style={{ fontSize: 13.5, color: T.text, marginBottom: 14, lineHeight: 1.6 }}><span style={{ color: T.muted }}>Hypothesis: </span>{exp.hypothesis}</div>
        <ul style={{ margin: "0 0 14px", paddingLeft: 18, fontSize: 13, color: T.text, lineHeight: 1.8 }}>
          {(exp.exact_actions || []).map((a, i) => <li key={i}>{a}</li>)}
        </ul>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 10, fontSize: 12.5, marginBottom: 14 }}>
          <div><span style={{ color: T.muted }}>Success metric: </span><span style={{ color: T.text }}>{exp.success_metric}</span></div>
          <div><span style={{ color: T.muted }}>Not yet: </span><span style={{ color: T.text }}>{exp.what_not_to_build_yet}</span></div>
        </div>
        <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic", borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
          Limitation: {exp.uncertainty_statement}
        </div>
      </Card>

      {criteria.length > 0 && paths.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: T.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 16 }}>Weighted comparison</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 480 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Criterion</th>
                  {paths.map((p, i) => <th key={i} style={thStyle}>{p.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {criteria.map((c, ci) => (
                  <tr key={ci}>
                    <td style={{ ...tdStyle, color: T.muted }}>{c.name} <span style={{ opacity: 0.6 }}>({Math.round((c.weight || 0) * 100)}%)</span></td>
                    {paths.map((_, pi) => (
                      <td key={pi} style={tdStyle}>{scores[`path_${pi}`]?.[`criterion_${ci}`] ?? "—"}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td style={{ ...tdStyle, color: T.white, fontWeight: 700, borderTop: `1px solid ${T.border}` }}>Weighted total</td>
                  {paths.map((_, pi) => (
                    <td key={pi} style={{ ...tdStyle, color: pi === highestIdx ? T.accent : T.white, fontWeight: 700, borderTop: `1px solid ${T.border}`, fontFamily: "'JetBrains Mono', monospace" }}>
                      {scores[`path_${pi}`]?.weighted_total ?? "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data.informational_note && (
        <ResponsibleAIStrip text={data.informational_note} />
      )}

      <ReasoningDisclosure steps={data.reasoning_steps} />

      {/* Final decision — explicitly the user's */}
      <div style={{ marginTop: 32 }}>
        <SectionTitle title="Your decision" sub="The scores above are an input, not an instruction. Pick the path you're actually going to take." />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {paths.map((p, i) => (
            <button
              key={i} onClick={() => setUserChoice(i)}
              style={{
                ...btnGhost, borderColor: userChoice === i ? T.accent : T.border,
                background: userChoice === i ? `${T.accent}1c` : "transparent",
                color: userChoice === i ? T.white : T.text,
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        {userChoice !== null && (
          <Card style={{ marginBottom: 20, borderColor: T.success + "44" }}>
            <div style={{ fontSize: 13.5, color: T.white }}>You chose: <strong>{paths[userChoice].name}</strong></div>
            <div style={{ fontSize: 12.5, color: T.muted, marginTop: 6 }}>The model scored this {scores[`path_${userChoice}`]?.weighted_total ?? "—"}/10 — its highest score was {paths[highestIdx]?.name}. Disagreeing with the score is a legitimate choice; you have context the model doesn't.</div>
          </Card>
        )}
        <Card style={{ marginBottom: 8, marginTop: 16 }}>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>What this tool does not decide</div>
          <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.65 }}>
            It does not commit you to a path, spend your budget, or know your risk tolerance, relationships, or timing constraints outside what you typed. Those judgment calls stay with you — this is the input, not the answer.
          </div>
        </Card>
        {data.what_would_change_this && (
          <div style={{ fontSize: 12, color: T.muted, marginTop: 16 }}>
            <strong style={{ color: T.text }}>What would change this: </strong>{data.what_would_change_this}
          </div>
        )}
      </div>

      <div style={{ marginTop: 32, display: "flex", gap: 12, justifyContent: "center" }}>
        <button onClick={startOver} style={btnGhost}>Start a new idea</button>
      </div>
    </div>
  );
}

function Meta({ label, value, badge }) {
  return (
    <div>
      <div style={{ color: T.muted, fontSize: 11 }}>{label}</div>
      {badge ? <Badge tone={riskTone(value)}>{value}</Badge> : <div style={{ color: T.text }}>{value}</div>}
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "8px 10px", color: T.muted, fontWeight: 500, borderBottom: `1px solid ${T.border}` };
const tdStyle = { padding: "9px 10px", color: T.text };
