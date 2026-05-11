import React, { useState, useEffect } from 'react'

interface Props {
 message: string
 onCancel?: () => void
}

// Estimate progress from message content
function estimateProgress(msg: string): number {
 const lower = msg.toLowerCase()
 if (lower.includes('analyzing (fast')) return 30
 if (lower.includes('loading audio')) return 5
 if (lower.includes('finding loudest')) return 10
 if (lower.includes('analyzing loudest')) return 15
 if (lower.includes('ai separating') && lower.includes('file a')) return 20
 if (lower.includes('separating') && lower.includes('chunk_a')) return 25
 if (lower.includes('processing') && !lower.includes('chunk_b')) return 30
 if (lower.includes('ai separating') && lower.includes('file b')) return 45
 if (lower.includes('separating') && lower.includes('chunk_b')) return 50
 if (lower.includes('analyzing ai')) return 65
 if (lower.includes('frequency analysis')) return 70
 if (lower.includes('running hybrid')) return 10
 if (lower.includes('scanning for digital')) return 80
 if (lower.includes('checking for distortion')) return 85
 if (lower.includes('generating visualization')) return 90
 if (lower.includes('done')) return 100
 return -1 // unknown
}

const jokes = [
 "Waiting for the kick to hit harder than your deadline...",
 "If the mix sounds good in the car, it's done. Everything else is just anxiety.",
 "A demo walks into a bar. The bartender says, 'We don't serve unfinished products here.'",
 "Mastering: turning 'it sounds great!' into 'it sounds great, but louder.'",
 "The snare asked the compressor for space. The compressor said 'what space?'",
 "How many producers does it take to finish a mix? One more revision.",
 "My mix sounded perfect at 3am. At 9am, not so much.",
 "The low end is like rent — you never have quite enough of it.",
 "EQ: fixing problems you created with other EQ.",
 "A vocal walks into a reverb. It never comes out.",
 "The demo was better. — Every artist, every time.",
 "Compression: because dynamics are overrated. (Just kidding, please don't.)",
 "Sidechain ducking is just the kick asserting dominance.",
 "Reference tracks exist to remind you how far you still have to go.",
 "The master is just the mix with a limiter and regret.",
 "Loudness war veteran checking in...",
 "If you can't hear the difference, the client definitely will.",
 "That high shelf at 10k? Chef's kiss or ear fatigue — nobody knows.",
 "Low cut everything. Even the sub. Especially the sub. Wait, no.",
 "The mix is never done. You just stop touching it.",
 "Auto-tune: because pitch is a suggestion.",
 "Bass: felt, not heard. Unless you're in a Honda Civic.",
 "A good mix is 10% talent, 90% not making it worse.",
 "Analog warmth: what we call distortion when it costs $3,000.",
 "The reverb tail is still going... still going... still going...",
 "Mid-side EQ: for when regular EQ isn't confusing enough.",
 "Trust your ears. Unless it's 2am. Then trust nothing.",
 "Clipping is just saturation for the brave.",
 "Phase cancellation: the sound of two speakers disagreeing.",
 "Your monitors are lying to you. So is your room. Trust the car.",
 "Measuring twice, delivering once.",
 "One more plugin and the mix will be perfect. (Narrator: it wasn't.)",
 "Parallel compression: because you want it both ways.",
 "The artist wants it louder. The mastering engineer wants to retire.",
 "A hi-hat and a de-esser walk into a bar. Sssssssuffering ensues.",
 "Gain staging: the thing everyone skips and then wonders why it sounds bad.",
 "I don't always check mono. But when I do, I cry.",
 "The best plugin is the one you already own but never learned.",
 "Headroom is not a room in your house.",
 "Your mix sounds different on every speaker because the universe hates you.",
 "808s: where the sub lives and the neighbors complain.",
 "That automation ride took longer than writing the song.",
 "Reverb pre-delay: the difference between 'in the room' and 'in the bathroom.'",
 "The best mix decision is sometimes deleting a track entirely.",
 "Stems delivered. Now watch the mastering engineer fix everything.",
 "Dithering: adding noise to make things sound better. Yes, really.",
 "A limiter's favorite phrase: 'Not on my watch.'",
 "When in doubt, add more reverb. When still in doubt, remove all reverb.",
 "Multiband compression: for when you want to feel smart and confused simultaneously.",
 "The click track is judging you.",
 "Autosave on. Coffee on. All is well.",
 "The client said 'make it pop.' Still not sure what that means.",
 "Aux sends: the group chat of audio signals.",
 "Just one more A/B comparison and I'll stop. (Five hours later...)",
 "The demo had vibe. The mix has precision. The master has volume. The artist wants the demo.",
 "Panning: deciding where things live so they stop fighting.",
 "That vintage compressor emulation costs $300 but sounds like $12.",
 "Every frequency is important until you solo it.",
 "The mix engineer's prayer: 'Please don't let them ask for stems.'",
 "Nyquist called. He wants his frequency back.",
 "Your sample rate is not a personality trait.",
 "If the vocal is buried, turn everything else down. Revolutionary, I know.",
 "De-essing: because the letter S is everyone's enemy.",
 "A/B testing: the art of making yourself more indecisive.",
 "Bounce in place, listen in car, question everything.",
 "The sub hits different on the studio monitors. And by different, I mean not at all.",
 "That snare sample has been in every hit song since 2015. You know the one.",
 "Exporting at 44.1kHz like it's still 1982. Some things never change.",
 "The master bus chain has 47 plugins. It's fine. Everything is fine.",
 "Mixing on headphones is like driving with sunglasses at night.",
 "That 'vintage' plugin was coded last Tuesday.",
 "Sidechain everything to the kick. Even the kick. Especially the kick.",
 "The producer wants the mix louder than the reference. The reference is already at -6 LUFS.",
 "You spent 4 hours on the snare. Nobody will ever notice.",
 "Recall a mix from 6 months ago? That's comedy, not engineering.",
 "Every plugin on sale is essential until you buy it.",
 "The vocal chain: EQ, compress, EQ, compress, de-ess, saturate, regret.",
 "Automation: the part of mixing that makes you question your life choices.",
 "Client: 'Can you just make it sound like The Weeknd?' Budget: $50.",
 "The difference between $200 and $2000 monitors? About $1800 in self-doubt.",
 "That feedback loop at soundcheck wasn't a mistake, it was free sound design.",
 "Mixing at 3am: where bad decisions sound like good ideas.",
 "Every mastering engineer has a secret 'undo everything the mixer did' preset.",
 "The best EQ move is the one you don't make.",
 "Your mix isn't finished. You're just tired of working on it.",
 "Noise floor: the sound of your gear judging you.",
 "Bus processing: because ruining things one track at a time was too slow.",
 "The artist wants the vocals louder AND the beat louder. Math has left the chat.",
 "Mid-side processing: for people who think regular stereo is too simple.",
 "Tuning vocals: the audio equivalent of photoshop.",
 "That SSL emulation was worth every penny of the $29 sale price.",
 "You haven't truly mixed until you've accidentally soloed the wrong track for 5 minutes.",
 "The kick and bass are fighting. Again. Like every session.",
 "Checking the mix on AirPods because that's what 80% of listeners use anyway.",
 "The mastering engineer just applied a high shelf. Revolutionary.",
 "Stem mastering: paying extra to be told your mix needs work.",
 "That preset is called 'Radio Ready.' The radio disagrees.",
 "Acoustic treatment: the least exciting and most important purchase.",
 "Rendering in real-time because your CPU gave up 3 plugins ago.",
 "The perfect mix exists. It's always the one before the last revision.",
 "Low-cut at 30Hz? At 40Hz? At 80Hz? The eternal question.",
 "Gain reduction meters: the mixing engineer's anxiety indicator.",
 "Your room modes are not a feature. They're a bug.",
 "The mix sounds perfect in the studio. The car says otherwise.",
 "Saturation: fancy word for 'I distorted it on purpose.'",
 "Version 47 of the mix. The client liked version 3.",
 "The only thing worse than too much reverb is not enough reverb. Or is it the other way around?",
]

// Fisher-Yates shuffle
function shuffleArray<T>(arr: T[]): T[] {
 const a = [...arr]
 for (let i = a.length - 1; i > 0; i--) {
 const j = Math.floor(Math.random() * (i + 1));
 [a[i], a[j]] = [a[j], a[i]]
 }
 return a
}

export default function ProgressBar({ message, onCancel }: Props) {
 // Shuffled queue — never repeats until all jokes shown
 const [queue, setQueue] = useState<number[]>(() => shuffleArray(jokes.map((_, i) => i)))
 const [queuePos, setQueuePos] = useState(0)
 const [fade, setFade] = useState(true)
 const [displayPct, setDisplayPct] = useState(0)

 const jokeIndex = queue[queuePos % queue.length]

 const targetPct = estimateProgress(message)

 // Smooth progress animation
 useEffect(() => {
 if (targetPct < 0) return
 const interval = setInterval(() => {
 setDisplayPct(prev => {
 if (prev >= targetPct) return targetPct
 return prev + 1
 })
 }, 50)
 return () => clearInterval(interval)
 }, [targetPct])

 useEffect(() => {
 const interval = setInterval(() => {
 setFade(false)
 setTimeout(() => {
 setQueuePos(prev => {
 const next = prev + 1
 // Reshuffle when we've gone through all jokes
 if (next >= queue.length) {
 setQueue(shuffleArray(jokes.map((_, i) => i)))
 return 0
 }
 return next
 })
 setFade(true)
 }, 400)
 }, 10000)
 return () => clearInterval(interval)
 }, [queue.length])

 // 5.3.0 a11y (SC 4.1.3): announce progress to assistive tech via
 // role="status" + aria-live="polite". The progressbar primitive
 // also gets explicit aria-valuenow / -valuemin / -valuemax so SR
 // users hear the percent each time the message text changes.
 const ariaValueNow = displayPct > 0 ? Math.round(displayPct) : undefined
 return (
 <div
 className="flex flex-col items-center justify-center py-24 space-y-8"
 role="status"
 aria-live="polite"
 aria-busy="true"
 >
 {/* Progress bar */}
 <div className="w-full max-w-xs space-y-2">
 <div
 className="h-1.5 overflow-hidden"
 role="progressbar"
 aria-valuenow={ariaValueNow}
 aria-valuemin={0}
 aria-valuemax={100}
 aria-label={message}
 style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '2px' }}
 >
 <div
 className="h-full transition-all duration-300"
 style={{
 width: `${displayPct}%`,
 backgroundColor: 'var(--color-sand-100)',
 borderRadius: '2px',
  }}
 />
 </div>
 <div className="flex justify-between items-center">
 <p className="text-xs tracking-wide" style={{ color: '#a59d8e' }}>{message}</p>
 {displayPct > 0 && (
 <span className="text-xs font-mono" style={{ color: '#a59d8e' }}>{displayPct}%</span>
 )}
 </div>
 </div>

 {/* Joke */}
 <p
 className="text-sm text-center max-w-md leading-relaxed transition-opacity duration-400"
 style={{
 color: '#a8a29e',
 opacity: fade ? 1 : 0,
 fontStyle: 'italic',
 }}
 >
 "{jokes[jokeIndex]}"
 </p>

 {/* Cancel button */}
 {onCancel && (
 <button
 onClick={onCancel}
 className="text-[11px] px-4 py-2 transition-colors"
 style={{
 color: '#c45c5c',
 border: '1px solid rgba(196,92,92,0.3)',
 backgroundColor: 'rgba(196,92,92,0.05)',
 borderRadius: '2px',
 }}
 title="Cancel scan and return to file selection"
 >
 Cancel scan
 </button>
 )}
 </div>
 )
}
