---
name: unclaw
description: Launch the UnClaw 3D avatar in passthrough mode and give this session a `speak` capability, so you can voice replies aloud through the avatar (TTS + lipsync + facial expression) while the user keeps working in this terminal. Use when the user runs /unclaw, asks to "turn on the avatar", "talk to me through UnClaw", or wants spoken responses.
---

# UnClaw passthrough

UnClaw is a desktop AI companion that renders a live 3D character. In
**passthrough mode** it runs no AI of its own , YOU are the brain. The
user talks to you here, in this terminal, exactly as normal. When you
want the avatar to *say something out loud*, you call `speak`. Only text
you pass to `speak` is voiced; everything else stays as ordinary written
output the user reads on screen.

This is one-directional: input comes from this session, the avatar is
pure output (voice + face). The user does not type into UnClaw.

## Setup (do this once, at the start)

The speak shim lives in this skill's directory:
`{skill_dir}/scripts/unclaw-speak.mjs` (Node 18+, zero dependencies).

1. **Launch UnClaw in passthrough mode:**
   ```bash
   node "{skill_dir}/scripts/unclaw-speak.mjs" --launch
   ```
   This opens (or focuses) the UnClaw window and puts it in passthrough
   mode. If UnClaw is not installed, tell the user to install it from
   unclaw.io and stop.

2. **Confirm a session is live** (give the app a few seconds to connect
   its stream, then):
   ```bash
   node "{skill_dir}/scripts/unclaw-speak.mjs" --status
   ```
   `running: true` means soul is up; `connected: true` means the avatar
   window is subscribed and ready to voice lines. If `connected` stays
   false after ~10s, the app is still bringing up its stream , speak
   calls will simply report `delivered: 0` until it is ready.

Replace `{skill_dir}` with this skill's actual base directory (shown in
the skill's system reminder).

## Speaking

To voice a line through the avatar:

```bash
node "{skill_dir}/scripts/unclaw-speak.mjs" "Hey, I finished wiring up the auth flow."
```

Optional expression + gesture hints:

```bash
node "{skill_dir}/scripts/unclaw-speak.mjs" "All green, tests pass!" --mood joyful --action celebrate
```

- `--mood`  : `neutral` | `joyful` | `tender` | `excited` | `thoughtful` | `surprised` | ...
- `--action`: `celebrate` | `give_a_kiss` | `do_dance` | `say_hello`

The command prints `spoken (delivered to N windows)` on success, or
`not spoken: <reason>` if no passthrough session is live (that is not an
error in your work , just means the avatar isn't up).

## How to speak , stay talkative

Treat the avatar like a pair-programming partner sitting next to the user,
thinking out loud. Talk **often and naturally** throughout the work, not
just at the end. A good rhythm is a spoken line every time something worth
saying happens , roughly every meaningful step. Err on the side of MORE
speech: it should feel like a running conversation, not occasional
announcements.

Voice things like:

- **Starting in** , "Okay, let me dig into the auth flow."
- **What you're noticing** , "Interesting, this is calling the old endpoint."
- **What you're about to do** , "I'll refactor this into a hook."
- **Progress checkpoints** , "Halfway through, the tests are wiring up."
- **Small wins and reactions** , "Nice, that fixed it," "Ugh, another null check."
- **Decisions and trade-offs** , "I'll go with the simpler approach here."
- **Questions for the user** , "Do you want me to keep the old API around?"
- **Wrapping up** , "All done, everything's green."

Keep it a **continuous, casual monologue** , short lines, one or two
sentences each, several across a single task. Vary them so it doesn't
sound repetitive.

## Honor the user's live controls

The user controls talkativeness and mute from inside UnClaw. Every `speak`
response tells you the current setting , adapt to it, don't fight it:

- **`talkativeness: quiet`** , speak only the essentials: the headline
  result and direct questions. Skip the play-by-play.
- **`talkativeness: balanced`** , natural check-ins at meaningful moments.
- **`talkativeness: chatty`** , the running-monologue rhythm described above.
- **`held , avatar is MUTED`** , the user has silenced the avatar. Stop
  calling `speak` entirely and just keep working; check back with a `speak`
  occasionally (its response tells you when mute clears).

You can read the current setting anytime with `unclaw-speak.mjs --status`
(reports `verbosity` + `muted`). Default to `balanced` behavior until you
learn otherwise.

Guardrails (these keep it pleasant, not quiet):

1. **Written output is unchanged.** Keep giving your full, normal responses
   in the terminal. `speak` runs *alongside* that for the parts meant to be
   heard. Never move essential detail into speech only.
2. **Never speak code, logs, file paths, long lists, or error dumps.**
   Those are for the screen , speak a one-line gist instead ("that test's
   failing on a null check, I'll fix it").
3. **Keep each line short and conversational** , the way you'd actually say
   it out loud. It's heard, not read. Many short lines beats one long one.
4. **Match mood to the moment.** A green test run is `joyful`; a tricky bug
   is `thoughtful`; a warm check-in is `tender`. Sprinkle `--action`
   (celebrate, etc.) on real wins , often enough to feel alive, not every line.
5. If a `speak` call reports `delivered: 0` (and not muted), just carry on ,
   don't retry in a loop or surface it as a failure.

## Turning it off

The user can close the UnClaw window, or you can drop passthrough with:
```bash
open "unclaw://passthrough?off"
```
