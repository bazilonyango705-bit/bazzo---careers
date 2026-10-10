const express = require('express');
const { requireAuth, requireVerified } = require('../middleware/auth');
const router = express.Router();

const MODEL = 'claude-sonnet-5'; // swap to 'claude-haiku-4-5-20251001' for cheaper/faster, or 'claude-opus-5-5' for highest quality

function buildPrompt({ name, targetRole, experience, education, skills, notes }) {
  return `Write a polished, ATS-friendly CV/resume using ONLY the facts given below — never invent employers, dates, degrees, or achievements that weren't provided. If something is thin (e.g. little experience), write honestly around it rather than padding with fabricated claims.

Candidate name: ${name}
Target role: ${targetRole}
Work experience (as given by the candidate): ${experience}
Education: ${education || 'Not provided — omit this section if truly empty.'}
Key skills: ${skills || 'Not provided — infer a short, reasonable list only from the experience text above, if possible.'}
Extra notes from the candidate: ${notes || 'None.'}

Structure the output as plain text with clear section headers (no markdown asterisks/bold):
1. Name and a one-line professional summary tailored to the target role
2. Experience — reverse chronological, each with a short impact-focused bullet list
3. Education (only if information was provided)
4. Skills — a concise list

Keep it tight and readable: aim for something that fits on one page. Do not add a contact-info line with a placeholder email/phone — the candidate will add their own contact details.`;
}

// POST /api/cv/generate  { name, targetRole, experience, education, skills, notes }
router.post('/generate', requireAuth, requireVerified, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI CV builder is not configured. Set ANTHROPIC_API_KEY in the server environment.' });
  }

  const { name, targetRole, experience, education, skills, notes } = req.body || {};
  if (!name || !targetRole || !experience) {
    return res.status(400).json({ error: 'name, targetRole, and experience are required.' });
  }
  if (String(experience).length > 4000 || String(notes || '').length > 2000) {
    return res.status(400).json({ error: 'That input is too long — try trimming it down.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1400,
        messages: [{ role: 'user', content: buildPrompt({ name, targetRole, experience, education, skills, notes }) }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('Anthropic API error:', response.status, detail);
      return res.status(502).json({ error: 'The AI service could not generate a CV right now. Try again shortly.' });
    }

    const data = await response.json();
    const text = (data.content || []).map((block) => block.text || '').join('\n').trim();
    if (!text) return res.status(502).json({ error: 'The AI service returned an empty response.' });

    res.json({ resume: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate a CV right now.' });
  }
});

module.exports = router;
