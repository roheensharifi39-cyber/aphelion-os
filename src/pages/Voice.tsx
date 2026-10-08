import { useEffect, useRef, useState } from 'react';
import type { Status } from '../types';
import { api } from '../lib/bridge';
import { Badge, Button, ErrorNote, SectionHeading } from '../components/UI';
import { PixelIcon } from '../components/PixelIcon';

type RecognitionEvent = { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; 0: { transcript: string } } } };
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onstart: (() => void) | null; onresult: ((event: RecognitionEvent) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void; abort: () => void };
type RecognitionConstructor = new () => Recognition;
type SpeechWindow = Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
type Props = { status: Status; notify: (text: string) => void; useTranscript: (text: string) => void; settings: () => void };

export function Voice({ status, notify, useTranscript }: Props) {
  const [text, setText] = useState('Welcome to Aphelion. Your agents, your ideas, and your memory. All in orbit.');
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const playbackGeneration = useRef(0);
  const recordingGeneration = useRef(0);
  const recognition = useRef<Recognition | null>(null);
  const RecognitionAPI = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
  const synthesisAvailable = 'speechSynthesis' in window;
  useEffect(() => {
    mounted.current = true;
    function loadVoices() { if (mounted.current && 'speechSynthesis' in window) setVoices(window.speechSynthesis.getVoices()); }
    loadVoices(); if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      mounted.current = false; playbackGeneration.current++; recordingGeneration.current++;
      if (recognition.current) { recognition.current.onresult = null; recognition.current.onerror = null; recognition.current.onend = null; recognition.current.abort(); recognition.current = null; }
      if ('speechSynthesis' in window) { window.speechSynthesis.removeEventListener('voiceschanged', loadVoices); window.speechSynthesis.cancel(); }
    };
  }, []);
  function speak() {
    setError(''); if (!synthesisAvailable) { setError('System speech is unavailable on this device.'); return; }
    const generation = ++playbackGeneration.current;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voices.find(v => v.voiceURI === voice) || null;
    utterance.onend = () => { if (mounted.current && generation === playbackGeneration.current) setSpeaking(false); };
    utterance.onerror = event => { if (mounted.current && generation === playbackGeneration.current) { setSpeaking(false); if (event.error !== 'canceled' && event.error !== 'interrupted') setError('System voice could not play. Choose another installed voice and try again.'); } };
    setSpeaking(true); window.speechSynthesis.speak(utterance);
  }
  function stopSpeaking() { playbackGeneration.current++; if (synthesisAvailable) window.speechSynthesis.cancel(); setSpeaking(false); }
  function stopRecording() { recordingGeneration.current++; recognition.current?.abort(); recognition.current = null; setRecording(false); setInterim(''); }
  function record() {
    if (recording) { stopRecording(); return; }
    if (!RecognitionAPI) { setError('Speech recognition is unavailable in this browser. You can type a transcript below or use ElevenLabs studio.'); return; }
    setError(''); setInterim('');
    const generation = ++recordingGeneration.current, listener = new RecognitionAPI();
    recognition.current = listener; listener.lang = navigator.language || 'en-US'; listener.continuous = false; listener.interimResults = true;
    listener.onstart = () => { if (!mounted.current || generation !== recordingGeneration.current) listener.abort(); };
    listener.onresult = event => {
      if (!mounted.current || generation !== recordingGeneration.current) return;
      let final = '', partial = '';
      for (let i = event.resultIndex; i < event.results.length; i++) { if (event.results[i].isFinal) final += event.results[i][0].transcript; else partial += event.results[i][0].transcript; }
      if (final) setTranscript(current => `${current}${current ? ' ' : ''}${final}`); setInterim(partial);
    };
    listener.onerror = event => {
      if (!mounted.current || generation !== recordingGeneration.current) return;
      setRecording(false); setInterim(''); recognition.current = null;
      setError(event.error === 'not-allowed' ? 'Microphone access was declined. Allow it in your browser to use speech recognition.' : event.error === 'no-speech' ? 'No speech detected. Try again when you are ready.' : `Speech recognition is unavailable right now (${event.error}). You can type your transcript below.`);
    };
    listener.onend = () => { if (mounted.current && generation === recordingGeneration.current) { setRecording(false); setInterim(''); recognition.current = null; } };
    try { setRecording(true); listener.start(); } catch (e) { setRecording(false); recognition.current = null; setError((e as Error).message); }
  }
  return <div className="voice-page page-content"><div className="page-intro"><div><div className="eyebrow">AUDIO TRANSMISSION</div><h1>Voice studio.</h1><p>Hear your words. Capture a thought. Keep the signal moving.</p></div><Badge tone="green">SYSTEM VOICE · FREE</Badge></div>
    <div className="voice-hero panel"><div className={`voice-wave ${speaking || recording ? 'animated' : ''}`} aria-hidden="true">{[14, 24, 16, 36, 52, 28, 68, 40, 80, 58, 92, 68, 48, 80, 40, 68, 24, 52, 36, 16, 24, 14].map((height, i) => <span key={i} style={{ height, animationDelay: `${i * .07}s` }} />)}</div><div className="voice-hero-label"><PixelIcon name="mic" size={12} />{recording ? 'MICROPHONE / LISTENING' : speaking ? 'AUDIO / PLAYING' : 'AUDIO CHANNEL / STANDBY'}</div><span className="voice-hero-coordinate">APH // SIGNAL 03</span></div>
    <div className="voice-grid"><section className="panel voice-card"><SectionHeading eyebrow="TEXT → VOICE" title="System playback" /><p className="field-help">Free speech using the voices installed on your device.</p><label className="field-label" htmlFor="system-voice">System voice</label><select id="system-voice" value={voice} onChange={e => setVoice(e.target.value)} disabled={speaking}><option value="">Device default</option>{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}</select><textarea aria-label="Text to speak" value={text} onChange={e => setText(e.target.value)} maxLength={5000} rows={5} /><div className="voice-card-footer"><span>{text.length} / 5,000 characters</span>{speaking ? <Button icon="stop" variant="danger" onClick={stopSpeaking}>Stop playback</Button> : <Button icon="play" variant="green" disabled={!text.trim() || !synthesisAvailable} onClick={speak}>Play voice</Button>}</div></section>
      <section className="panel voice-card"><SectionHeading eyebrow="VOICE → TEXT" title="Capture a thought" /><p className="recording-description">Speech recognition works when supported by your browser. Review the transcript before sending it to an agent.</p><div className="record-zone"><button className={`record-button ${recording ? 'recording' : ''}`} aria-label={recording ? 'Stop recording' : 'Start recording'} onClick={record} disabled={!RecognitionAPI}><PixelIcon name={recording ? 'stop' : 'mic'} size={24} /></button><span>{recording ? 'Listening · click to stop' : RecognitionAPI ? 'Click to start speech recognition' : 'Recognition unavailable in this browser'}</span>{interim && <p className="interim-transcript">{interim}</p>}</div><textarea aria-label="Voice transcript" placeholder="Your transcript appears here. You can also type it." value={transcript} onChange={e => setTranscript(e.target.value)} rows={3} /><Button icon="arrow" variant="green" disabled={!transcript.trim()} onClick={() => { stopRecording(); useTranscript(transcript); }}>Use in workbench</Button><div className="recording-note"><PixelIcon name="mic" size={12} /><span>{status.desktop ? 'Availability depends on your desktop speech engine.' : 'Your browser may use its speech service for recognition.'}</span></div></section></div>
    <section className="panel elevenlabs-launcher"><div className="item-slot"><PixelIcon name="mic" size={24} /></div><div><div className="eyebrow">YOUR EXISTING SUBSCRIPTION</div><h2>ElevenLabs studio</h2><p>Open the official studio for your voices, projects, and subscription tools.</p></div><Button icon="arrow" onClick={() => void api.openExternal('https://elevenlabs.io/app').catch(e => notify(e.message))}>Open ElevenLabs</Button></section><ErrorNote text={error} />
  </div>;
}
