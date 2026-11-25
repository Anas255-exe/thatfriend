# 🎤 ThatFriend: demo script (Festive Hacks)

**One-liner:** *Nobody wants to be "that friend" who books the whole trip, so we built one.* ThatFriend is an AI agent on Telegram. It plans the trip, texts (and calls) your friends in their own language, and books everything once you approve. Humans stay in control through Flagsmith kill switches and NudgeBee approvals.

**Sponsors used:**
- 🚩 **Flagsmith:** kill switches, per-user flags and a live A/B/n experiment.
- 🗣️ **Sarvam:** voice calls and voice notes in 11 Indian languages, translation, speech-to-text, and a fallback LLM.
- 🐝 **NudgeBee:** approval-gated checkout runbook and self-healing bookings.

---

## Before you go on stage (5 min)

1. `cd thatfriend` then `.\start.ps1`. The console should show `connected as @ThatFriendTripBot`.
2. Open these tabs:
   - **Tab 1:** http://localhost:8787 (landing)
   - **Tab 2:** http://localhost:8787/demo (live demo). The header chips should show Claude Code, Sarvam: live, Flagsmith: live.
   - **Tab 3:** Flagsmith → Features (flip flags live)
   - **Tab 4:** Flagsmith → Experiments → "How should ThatFriend invite friends?"
   - **Tab 5:** NudgeBee workflow (if connected)
   - **Phone:** Telegram open on @ThatFriendTripBot. Mirror it if you can.
3. In Flagsmith, make sure `payments_enabled`, `autonomous_booking` and `friend_outreach` are **ON**, and `booking_failure_drill` is **OFF**.
4. On the demo page, click **↺ Reset demo**.
5. Want instant replies? Set `LLM_MODE=offline` in `.env`. Claude Code replies take 20–40 s per step; offline replies are instant and the voices still work.

## The 3-minute demo

| Time | Say | Do |
|---|---|---|
| 0:00 | "Every group trip dies in the group chat. One person ends up doing all the bookings, and something gets booked wrong." | Landing page, scroll once. |
| 0:20 | "So you just text ThatFriend." | `/demo` → click the sample prompt: *Plan Ooty next weekend with Aman, Riya and Kabir, 15k per person* |
| 0:40 | "Claude Code drafts 3 real itineraries within budget. I can tweak in plain words." | Pick A. Optional: type "add the toy train". |
| 1:00 | "Now the part nobody wants to do: asking friends. ThatFriend does it for me, in each friend's language." | Click **Ask the squad**. Phones **ring** 📞. Click **Answer** on Riya's phone: Tamil voice from Sarvam. |
| 1:20 | "Which works best: text, voice note or a call? That's a live **Flagsmith experiment**. Each friend is bucketed, and every 'yes' is a conversion event." | Point at the 🧪 experiment panel, then show **Tab 4** (Running). |
| 1:40 | "Friends reply with requests ('veg food pls') and the plan adapts." | Personas reply. Agent Brain shows the plan adjusting. |
| 1:55 | "Before it spends money: what if something goes wrong? Flagsmith kill switch." | **Tab 3:** flip `payments_enabled` **OFF**. Click **Approve & book** → "🛑 Payments are paused." |
| 2:10 | "Flip it back: no redeploy." | Flip **ON** → Approve again. |
| 2:15 | "Big checkouts go through a **NudgeBee approval runbook**." | Gate appears → approve in NudgeBee (or **Sign off**). |
| 2:30 | "OTP, then it books everything. And if a provider goes down mid-booking…" | (Before approving, flip `booking_failure_drill` ON.) Enter the OTP from the yellow SMS bubble → Agent Brain: *StaySandbox 503 → NudgeBee runbook fails over → recovered*. |
| 2:50 | "Done. PNRs to everyone, a voice note in each friend's language, and a UPI request for their share. Nobody had to be *that friend*." | Show friend phones: confirmations + 🎙️ voice note. |

**Bonus, live on Telegram:** send the bot a **voice note** in Hindi. Sarvam transcribes it and the agent replies.

## Backup plan

- Wi-Fi dies: set `LLM_MODE=offline`. The flow still works fully. Voice falls back to the browser's voices, and the flags use their last-known defaults.
- Telegram is slow: run the whole story on `/demo`, which shows the same engine.
- Something got stuck: **↺ Reset demo**, then `/new` in Telegram.

## Submission checklist (deadline 5:00 PM IST)

- [ ] Team registered on the Festive Hacks resources page (everyone accepted on Luma).
- [ ] Public GitHub repo, with `.env` **not** committed (it's in `.gitignore`).
- [ ] README with setup steps ✅ ([README.md](README.md)).
- [ ] **AI disclosure** in the README ✅ (rules require it).
- [ ] Demo video: record the 3-minute script above, including the Flagsmith flip and a phone ringing.
- [ ] Confirm with organizers: rules say main coding starts after the hackathon starts.
