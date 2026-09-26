type Request = <T>(path: string, data?: unknown) => Promise<T>;
export class Voice {
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private mic?: MediaStream;
  private ready = false;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private durationTimer?: ReturnType<typeof setTimeout>;
  private seen = new Set<string>();
  constructor(private request: Request, private audio: HTMLAudioElement,
    private status: (value: string) => void, private transcript: (value: string) => void) {}
  async start(q: { id: string; version: number; question: string; reason: string }) {
    this.cleanup(); this.seen.clear(); this.status('マイクと音声接続を準備しています…');
    const peer = new RTCPeerConnection(); this.peer = peer;
    try {
      peer.addEventListener('track', e => {
        this.audio.srcObject = new MediaStream([e.track]);
        void this.audio.play().catch(() => this.status('音声プレーヤーの再生ボタンを押してください。'));
      });
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (this.peer !== peer) { mic.getTracks().forEach(t => t.stop()); return; }
      this.mic = mic; mic.getAudioTracks().forEach(t => peer.addTrack(t, mic));
      const channel = peer.createDataChannel('oai-events'); this.channel = channel;
      channel.addEventListener('message', e => {
        if (this.peer !== peer) return;
        let event: Record<string, unknown>;
        try { event = JSON.parse(String(e.data)) as Record<string, unknown>; } catch { return; }
        if (event.type === 'session.started') {
          this.ready = true; this.status('接続しました。質問への返答を話してください。');
          channel.send(JSON.stringify({ type: 'session.commentary.append', event_id: crypto.randomUUID(),
            delegation_id: null, content: q.question.slice(0, 500) }));
          this.durationTimer = setTimeout(() => this.stop(), 5 * 60_000);
        } else if (event.type === 'session.input_transcript.delta' && typeof event.delta === 'string') {
          const eventId = typeof event.event_id === 'string' ? event.event_id : JSON.stringify([event.start_ms, event.end_ms, event.delta]);
          if (!this.seen.has(eventId)) { this.seen.add(eventId); this.transcript(event.delta); }
        } else if (event.type === 'session.delegation.created') {
          const delegation = event.delegation as { id?: string } | undefined;
          if (delegation?.id) channel.send(JSON.stringify({ type: 'session.commentary.append', event_id: crypto.randomUUID(),
            delegation_id: delegation.id, content: 'この確認への返答は下書きにしています。訂正があれば続けて話し、画面で確定してください。まだ作業への反映はしていません。' }));
        } else if (event.type === 'session.closed') {
          this.status('音声を終了しました。返答の下書きを確認してください。'); this.cleanup();
        } else if (event.type === 'error' || event.type === 'session.error') {
          this.status('音声サービスでエラーが発生しました。接続を終了します。'); this.cleanup();
        }
      });
      channel.addEventListener('close', () => {
        if (this.peer === peer) { this.status('音声接続が切れました。最終利用量は未確認です。'); this.cleanup(); }
      });
      peer.addEventListener('connectionstatechange', () => {
        if (this.peer === peer && peer.connectionState === 'failed') { this.status('音声接続に失敗しました。'); this.cleanup(); }
      });
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
        const done = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', done); resolve(); } };
        const timer = setTimeout(() => { peer.removeEventListener('icegatheringstatechange', done); reject(new Error('ICE接続の準備がタイムアウトしました。')); }, 10_000);
        peer.addEventListener('icegatheringstatechange', done); done();
      });
      if (this.peer !== peer) return;
      const result = await this.request<{ transport: { sdp: string }; consultationId: string }>('/api/live/session',
        { consultationId: q.id, expectedVersion: q.version, sdp: peer.localDescription?.sdp });
      if (this.peer !== peer) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
      this.closeTimer = setTimeout(() => {
        if (this.peer === peer && !this.ready) { this.status('音声セッション開始を確認できませんでした。'); this.cleanup(); }
      }, 20_000);
    } catch (e) { if (this.peer === peer) { this.cleanup(); this.status(e instanceof Error ? e.message : '音声を開始できませんでした。'); } }
  }
  stop() {
    if (this.channel?.readyState === 'open' && this.ready) {
      this.status('音声を終了しています…'); this.channel.send(JSON.stringify({ type: 'session.close' }));
      if (this.closeTimer) clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => { this.status('終了通知が未確認です。マイク接続を停止しました。'); this.cleanup(); }, 5000);
    } else this.cleanup();
  }
  cleanup() {
    const peer = this.peer, channel = this.channel;
    this.peer = undefined; this.channel = undefined; this.ready = false;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (this.durationTimer) clearTimeout(this.durationTimer);
    this.mic?.getTracks().forEach(t => t.stop()); this.mic = undefined;
    channel?.close(); peer?.close(); this.audio.srcObject = null;
  }
}
