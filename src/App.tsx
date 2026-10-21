import { useEffect, useRef, useState } from 'react';
import { initWizardChess } from './wizardChessEngine.js';
import { onlineManager, OnlineClientState, ChatMessage } from './onlineClient';
import { voiceChat, VoiceChatState } from './voiceChat';

export default function App() {
  const initializedRef = useRef(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [onlineState, setOnlineState] = useState<OnlineClientState>(onlineManager.state);
  const [voiceState, setVoiceState] = useState<VoiceChatState>(voiceChat.state);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const [lobbyTab, setLobbyTab] = useState<'quick' | 'custom' | 'join' | 'single' | 'script'>('quick');
  const [quickTime, setQuickTime] = useState<'none' | '3m' | '5m' | '10m'>('none');
  const [quickSide, setQuickSide] = useState<'w' | 'b' | 'random'>('random');
  const [customColor, setCustomColor] = useState<'w' | 'b'>('w');
  const [customTime, setCustomTime] = useState<'none' | '3m' | '5m' | '10m'>('none');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [searchingMatch, setSearchingMatch] = useState(false);
  const [searchElapsed, setSearchElapsed] = useState(0);
  const [publicRooms, setPublicRooms] = useState<any[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [incomingChatToast, setIncomingChatToast] = useState<{ senderName: string; text: string; isEmote?: boolean } | null>(null);
  const [matchOptionsOpen, setMatchOptionsOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [confirmResignOpen, setConfirmResignOpen] = useState(false);
  const [soundVolume, setSoundVolume] = useState(() => {
    try {
      const saved = localStorage.getItem('wizard_chess_volume');
      return saved !== null && !isNaN(Number(saved)) ? Number(saved) : 0.85;
    } catch (e) {
      return 0.85;
    }
  });
  const [soundMuted, setSoundMuted] = useState(() => {
    try {
      return localStorage.getItem('wizard_chess_muted') === 'true';
    } catch (e) {
      return false;
    }
  });
  const [customPassword, setCustomPassword] = useState('');
  const [createdRoomHasPassword, setCreatedRoomHasPassword] = useState(false);
  const [joinPasswordInput, setJoinPasswordInput] = useState('');
  const [pendingJoinRoomCode, setPendingJoinRoomCode] = useState<string | null>(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [matchmakingExpanded, setMatchmakingExpanded] = useState(false);
  const [graphicsQuality, setGraphicsQuality] = useState<'fast' | 'smooth' | 'ultra'>('smooth');
  const lastMsgCountRef = useRef(0);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const chatToastTimerRef = useRef<any>(null);

  // Initialize 3D Engine
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    initWizardChess();
  }, []);

  // Matchmaking Lock Effect: Lock all background UI when searching for match
  useEffect(() => {
    let timer: any = null;
    if (searchingMatch) {
      setSearchElapsed(0);
      document.body.classList.add('matchmaking-active-locked');
      const win = window as any;
      win.wizardChess?.setMatchmakingLocked?.(true);
      timer = setInterval(() => {
        setSearchElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      document.body.classList.remove('matchmaking-active-locked');
      const win = window as any;
      win.wizardChess?.setMatchmakingLocked?.(false);
    }
    return () => {
      if (timer) clearInterval(timer);
      document.body.classList.remove('matchmaking-active-locked');
      const win = window as any;
      win.wizardChess?.setMatchmakingLocked?.(false);
    };
  }, [searchingMatch]);

  // Subscribe to Online State and Voice State
  useEffect(() => {
    const unsubOnline = onlineManager.subscribe((st) => {
      setOnlineState({ ...st });
      if (st.roomCode && searchingMatch && st.status === 'playing') {
        setSearchingMatch(false);
        setLobbyOpen(false);
        const win = window as any;
        win.wizardChess?.playMatchFoundSound?.();
        showToast('⚔️ Opponent Found! Duel Beginning...');
      }
    });

    const unsubVoice = voiceChat.subscribe((vst) => {
      setVoiceState({ ...vst });
    });

    return () => {
      unsubOnline();
      unsubVoice();
    };
  }, [searchingMatch]);

  // Track chat messages: notify opponent with chime + floating bubble
  useEffect(() => {
    const len = onlineState.chatMessages.length;
    if (len > lastMsgCountRef.current) {
      const latestMsg = onlineState.chatMessages[len - 1];
      const isMine =
        (latestMsg.sender === 'w' && onlineState.playerColor === 'w') ||
        (latestMsg.sender === 'b' && onlineState.playerColor === 'b');

      if (!isMine && latestMsg.sender !== 'system') {
        // Opponent message arrived: play notification chime sound
        const win = window as any;
        win.wizardChess?.playChatNotificationSound?.();

        // Show floating message popup if chat is closed so player notices it immediately
        if (!chatOpen) {
          setIncomingChatToast({
            senderName: latestMsg.senderName,
            text: latestMsg.text,
            isEmote: latestMsg.isEmote
          });
          if (chatToastTimerRef.current) clearTimeout(chatToastTimerRef.current);
          chatToastTimerRef.current = setTimeout(() => {
            setIncomingChatToast(null);
          }, 4500);
        }
      }

      if (chatOpen) {
        setUnreadChatCount(0);
        if (chatMessagesEndRef.current) {
          chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
      } else {
        setUnreadChatCount((prev) => prev + (len - lastMsgCountRef.current));
      }
      lastMsgCountRef.current = len;
    }
  }, [onlineState.chatMessages.length, chatOpen, onlineState.playerColor]);

  // Fetch public waiting rooms
  const refreshPublicRooms = async () => {
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.rooms)) {
          setPublicRooms(data.rooms);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch public rooms:', e);
    }
  };

  useEffect(() => {
    if (lobbyOpen && lobbyTab === 'join') {
      refreshPublicRooms();
      const interval = setInterval(refreshPublicRooms, 3000);
      return () => clearInterval(interval);
    }
  }, [lobbyOpen, lobbyTab]);

  // Custom events & Keyboard shortcut listener (H = Hide UI, C = Toggle Chat, ?/K = Shortcuts, Escape = Close modals)
  useEffect(() => {
    const handleToggleChat = () => setChatOpen((prev) => !prev);
    const handleToggleShortcuts = () => setShortcutsModalOpen((prev) => !prev);
    window.addEventListener('toggle-chat', handleToggleChat);
    window.addEventListener('toggle-shortcuts-modal', handleToggleShortcuts);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'Escape') {
        if (searchingMatch) {
          setSearchingMatch(false);
          onlineManager.leaveRoom();
          return;
        }
        setMobileSheetOpen(false);
        setChatOpen(false);
        setLobbyOpen(false);
        setMatchOptionsOpen(false);
        setShortcutsModalOpen(false);
        setSettingsModalOpen(false);
        setConfirmResignOpen(false);
      } else if (e.key === 'c' || e.key === 'C') {
        setChatOpen((prev) => !prev);
      } else if (e.key === '?' || e.key === 'k' || e.key === 'K') {
        setShortcutsModalOpen((prev) => !prev);
      }
    };
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setMobileSheetOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('toggle-chat', handleToggleChat);
      window.removeEventListener('toggle-shortcuts-modal', handleToggleShortcuts);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [searchingMatch]);

  // Close match options dropdown on outside click
  useEffect(() => {
    if (!matchOptionsOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.match-options-container')) {
        setMatchOptionsOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [matchOptionsOpen]);

  const handleLeaveRoom = () => {
    onlineManager.leaveRoom();
    const overlay = document.getElementById('checkmate-overlay');
    if (overlay) overlay.classList.remove('visible');
    const win = window as any;
    if (win.wizardChess?.resetChessBoard) {
      win.wizardChess.resetChessBoard(true, false);
    }
    showToast('Exited match. Returned to Solo Sanctum');
  };

  const handleConfirmResign = (exitDirectly = false) => {
    setConfirmResignOpen(false);
    if (isOnlineActive) {
      onlineManager.resign();
      const win = window as any;
      if (win.wizardChess?.resignMatch) {
        win.wizardChess.resignMatch(onlineState.playerColor);
      }
      if (exitDirectly) {
        setTimeout(() => {
          handleLeaveRoom();
        }, 600);
        showToast('Resigned match and returned to Solo Sanctum.');
      } else {
        showToast('You resigned the match.');
      }
    } else {
      const win = window as any;
      if (win.wizardChess?.resignMatch) {
        win.wizardChess.resignMatch();
      }
      showToast('You resigned the match.');
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleRestoreUI = () => {
    const win = window as unknown as { wizardChess?: { toggleUI?: (force?: boolean) => void } };
    if (win.wizardChess?.toggleUI) {
      win.wizardChess.toggleUI(false);
    } else {
      document.body.classList.remove('cinematic-ui-hidden');
      const btnHide = document.getElementById('btn-hide-ui');
      if (btnHide) btnHide.textContent = 'Hide UI [H]';
    }
  };

  const handleSendChat = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;
    onlineManager.sendChat(chatInput);
    setChatInput('');
  };

  const handleSendEmote = (emoteText: string) => {
    onlineManager.sendChat(emoteText, true);
  };

  const handleStartQuickMatch = () => {
    setSearchingMatch(true);
    setMatchmakingExpanded(false);
    onlineManager.quickMatch(quickTime, quickSide);
  };

  const handleCancelQuickMatch = () => {
    setSearchingMatch(false);
    setMatchmakingExpanded(false);
    onlineManager.leaveRoom();
    showToast('Matchmaking cancelled.');
  };

  const handleVolumeChange = (vol: number) => {
    setSoundVolume(vol);
    const win = window as any;
    win.wizardChess?.setVolume?.(vol);
    if (vol > 0 && soundMuted) setSoundMuted(false);
    win.wizardChess?.soundEngine?.playSelectSound?.();
  };

  const handleToggleSoundMute = () => {
    const win = window as any;
    if (win.wizardChess?.toggleSound) {
      const active = win.wizardChess.toggleSound();
      setSoundMuted(!active);
    }
  };

  const handleVoiceSpeakerVolumeChange = (vol: number) => {
    voiceChat.setSpeakerVolume(vol);
  };

  const handleToggleSpeaker = () => {
    const isMuted = voiceChat.toggleSpeaker();
    showToast(isMuted ? '🔇 Opponent voice muted' : '🔊 Opponent voice unmuted');
  };

  const handleSetGraphics = (q: 'fast' | 'smooth' | 'ultra') => {
    setGraphicsQuality(q);
    const win = window as any;
    win.wizardChess?.setGraphicsQuality?.(q);
    showToast(`Graphics mode set to ${q.toUpperCase()}`);
  };

  const handleCreateCustomRoom = async () => {
    const code = await onlineManager.createRoom(customColor, customTime, customPassword);
    if (code) {
      setCreatedRoomCode(code);
      setCreatedRoomHasPassword(Boolean(customPassword.trim()));
      showToast(`Room ${code} created!`);
    }
  };

  const handleJoinByCode = async (code: string, password?: string) => {
    const result = await onlineManager.joinRoom(code, password);
    if (result.ok) {
      setLobbyOpen(false);
      setPasswordModalOpen(false);
      setJoinCodeInput('');
      setJoinPasswordInput('');
      setPendingJoinRoomCode(null);
      showToast(`Connected to room ${code}!`);
    } else if (result.requirePassword) {
      setPendingJoinRoomCode(code);
      setPasswordModalOpen(true);
      showToast('This room requires a password.');
    } else {
      showToast(result.error || 'Failed to join room');
    }
  };

  const handleToggleVoice = async () => {
    if (voiceState.connected) {
      voiceChat.stopVoice();
      showToast('Microphone disconnected');
    } else if (onlineState.roomCode) {
      const isInitiator = onlineState.playerColor === 'w';
      const ok = await voiceChat.startVoice(onlineState.roomCode, isInitiator, (stream) => {
        onlineManager.attachRemoteAudio(stream);
      });
      if (ok) {
        showToast('Microphone connected! Talk to opponent');
      } else {
        showToast('Could not access microphone');
      }
    }
  };

  const formatClock = (seconds: number) => {
    if (seconds <= 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const isOnlineActive = onlineState.mode === 'online2p' && Boolean(onlineState.roomCode);

  return (
    <>
      <div id="loading-overlay">
        <div className="loader-title">Wizard Chess</div>
        <div className="loader-bar-wrap">
          <div className="loader-bar" id="loader-bar"></div>
        </div>
        <div id="loader-text">Summoning Sanctum Architecture &amp; Sculpted Pieces...</div>
      </div>

      <div id="canvas-container"></div>

      <button
        type="button"
        className="hud-btn mobile-only-restore-ui"
        id="btn-mobile-show-ui"
        onClick={handleRestoreUI}
        title="Show HUD Controls"
      >
        Show UI
      </button>

      {/* Floating Alert Toast (Draw Offers, Rematches, Info) */}
      {toastMessage && (
        <div className="online-alert-toast" role="alert">
          <span className="toast-message">{toastMessage}</span>
        </div>
      )}

      {/* Opponent Offered Draw Dialog Toast */}
      {onlineState.drawOfferedToMe && (
        <div className="online-alert-toast" role="alert">
          <span className="toast-message">🤝 Opponent offered a draw. Accept?</span>
          <button
            type="button"
            className="toast-btn accept"
            onClick={() => onlineManager.respondDraw(true)}
          >
            Accept Draw
          </button>
          <button
            type="button"
            className="toast-btn decline"
            onClick={() => onlineManager.respondDraw(false)}
          >
            Decline
          </button>
        </div>
      )}

      {/* Opponent Wants Rematch Dialog Toast */}
      {onlineState.rematchRequestedByOpponent && (
        <div className="online-alert-toast" role="alert">
          <span className="toast-message">🔄 Opponent wants a rematch!</span>
          <button
            type="button"
            className="toast-btn accept"
            onClick={() => onlineManager.requestRematch()}
          >
            Accept Rematch
          </button>
        </div>
      )}

      {/* Top HUD */}
      <div id="hud-top" className={isOnlineActive ? 'online-live-hud' : ''}>
        <div className="hud-group" id="hud-left">
          {/* Brand title is cleanly hidden in online live mode so board pieces are never obstructed */}
          {!isOnlineActive && (
            <div className="brand-pill">
              <span className="brand-title">Wizard Chess</span>
            </div>
          )}



          <div
            className="status-pill"
            id="status-pill"
            style={{ display: isOnlineActive ? 'none' : 'flex' }}
          >
            <span className="turn-dot" id="turn-dot"></span>
            <span id="turn-text">White to Move</span>
            <span className="mode-badge" id="mode-badge">
              Solo vs AI
            </span>
          </div>

          {isOnlineActive && (
            /* Streamlined, Minimalist Online Match Top Bar */
            <div className="online-top-panel clean-bar">
              {/* White Player Clock Card */}
              <div
                className={`player-clock-card mini-player-tag ${onlineState.turn === 'w' ? 'active-turn' : ''} ${
                  onlineState.timeControl !== 'none' && onlineState.whiteTime <= 30 ? 'low-time' : ''
                }`}
                title={`White: ${onlineState.playerColor === 'w' ? `${onlineState.playerName} (You)` : onlineState.opponentName || 'Opponent'}`}
              >
                <span className="player-crown-icon">♔</span>
                <span className="player-name-text">
                  {onlineState.playerColor === 'w' ? 'You' : onlineState.opponentName || 'Opponent'}
                </span>
                <span className={`player-status-dot ${onlineState.whiteConnected ? '' : 'offline'}`}></span>
                {onlineState.timeControl !== 'none' && (
                  <span className="clock-digits">{formatClock(onlineState.whiteTime)}</span>
                )}
              </div>

              {/* Room Code Badge */}
              <div
                className="room-code-badge"
                title="Click to copy Room Code & Share invite link"
                onClick={() => {
                  if (onlineState.roomCode) {
                    navigator.clipboard?.writeText(
                      `${window.location.origin}${window.location.pathname}?room=${onlineState.roomCode}`
                    );
                    showToast(`Copied Room Code & Invite Link: ${onlineState.roomCode}`);
                  }
                }}
              >
                <span>🏰</span>
                <strong>{onlineState.roomCode}</strong>
                {onlineState.pingMs > 0 && <span className="ping-tag">{onlineState.pingMs}ms</span>}
              </div>

              {/* Black Player Clock Card */}
              <div
                className={`player-clock-card mini-player-tag ${onlineState.turn === 'b' ? 'active-turn' : ''} ${
                  onlineState.timeControl !== 'none' && onlineState.blackTime <= 30 ? 'low-time' : ''
                }`}
                title={`Black: ${onlineState.playerColor === 'b' ? `${onlineState.playerName} (You)` : onlineState.opponentName || 'Opponent'}`}
              >
                <span className="player-crown-icon">♚</span>
                <span className="player-name-text">
                  {onlineState.playerColor === 'b' ? 'You' : onlineState.opponentName || 'Opponent'}
                </span>
                <span className={`player-status-dot ${onlineState.blackConnected ? '' : 'offline'}`}></span>
                {onlineState.timeControl !== 'none' && (
                  <span className="clock-digits">{formatClock(onlineState.blackTime)}</span>
                )}
              </div>

              {/* Quick Actions Directly on Online Bar (Clean, uncluttered, no board obstruction) */}
              <div className="online-header-actions">
                <button
                  type="button"
                  className={`hud-btn online-mini-btn ${chatOpen ? 'active' : ''}`}
                  onClick={() => setChatOpen((prev) => !prev)}
                  title="Open Chat [C]"
                >
                  💬
                  {unreadChatCount > 0 && <span className="live-chat-badge pulse-badge">{unreadChatCount}</span>}
                </button>

                <button
                  type="button"
                  className={`hud-btn online-mini-btn ${
                    voiceState.connected ? (voiceState.muted ? 'muted' : voiceState.localSpeaking ? 'speaking' : 'active') : ''
                  }`}
                  onClick={handleToggleVoice}
                  title={
                    voiceState.connected
                      ? voiceState.muted
                        ? 'Unmute Microphone'
                        : 'Mute Microphone'
                      : 'Turn On Voice Microphone'
                  }
                >
                  {voiceState.connected ? (voiceState.muted ? '🔇' : '🎙️') : '🎙️'}
                </button>

                <button
                  type="button"
                  className={`hud-btn online-mini-btn ${
                    voiceState.speakerMuted ? 'muted' : voiceState.peerSpeaking ? 'speaking' : 'active'
                  }`}
                  onClick={handleToggleSpeaker}
                  title={
                    voiceState.speakerMuted
                      ? 'Unmute Opponent Audio (Speaker)'
                      : 'Mute Opponent Audio'
                  }
                >
                  {voiceState.speakerMuted ? '🔈' : '🔊'}
                </button>

                <button
                  type="button"
                  className="hud-btn online-mini-btn"
                  onClick={() => setSettingsModalOpen(true)}
                  title="Sanctum Audio & Display Settings"
                >
                  ⚙️
                </button>

                <button
                  type="button"
                  className="hud-btn online-mini-btn resign-mini-btn"
                  onClick={() => setConfirmResignOpen(true)}
                  title="Concede & Resign Match"
                >
                  🏳️
                </button>

                {onlineState.status === 'ended' && (
                  <button
                    type="button"
                    className="hud-btn online-mini-btn"
                    style={{
                      background: 'linear-gradient(135deg, rgba(230,57,70,0.45), rgba(230,57,70,0.2))',
                      borderColor: '#e63946',
                      color: '#ff9999',
                      fontWeight: 700,
                      padding: '0 10px',
                      whiteSpace: 'nowrap'
                    }}
                    onClick={handleLeaveRoom}
                    title="Exit match and return to Solo Sanctum"
                  >
                    🚪 Exit Match
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`hud-btn mobile-controls-trigger ${mobileSheetOpen ? 'active' : ''}`}
          id="btn-mobile-controls"
          aria-expanded={mobileSheetOpen}
          aria-controls="hud-right"
          onClick={() => setMobileSheetOpen((prev) => !prev)}
        >
          {mobileSheetOpen ? 'Close' : 'Controls'}
        </button>

        <div
          className={`mobile-sheet-backdrop ${mobileSheetOpen ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setMobileSheetOpen(false);
          }}
          aria-hidden="true"
        ></div>

        <div className={`hud-group ${mobileSheetOpen ? 'mobile-sheet-open' : ''}`} id="hud-right">
          <div
            className="mobile-sheet-handle-wrap"
            onClick={(e) => {
              e.stopPropagation();
              setMobileSheetOpen(false);
            }}
            aria-hidden="true"
          >
            <div className="mobile-sheet-handle"></div>
          </div>

          <div className="mobile-sheet-header">
            <span className="mobile-sheet-title">Sanctum Controls</span>
            <button
              type="button"
              className="mobile-sheet-close"
              id="btn-mobile-sheet-close"
              onClick={(e) => {
                e.stopPropagation();
                setMobileSheetOpen(false);
              }}
              aria-label="Close Controls"
            >
              Close ✕
            </button>
          </div>

          {/* Game Mode & Match Actions (Solo) */}
          <div className="mobile-sheet-section-label" style={{ display: isOnlineActive ? 'none' : 'block' }}>
            Game Mode &amp; Match Actions
          </div>

          {!isOnlineActive ? (
            <div className="solo-actions-wrap">
              <button
                className="hud-btn highlight-btn"
                style={{
                  background: 'linear-gradient(135deg, rgba(212,175,55,0.32), rgba(212,175,55,0.12))',
                  borderColor: '#d4af37',
                  color: '#f5d76e'
                }}
                onClick={() => {
                  setLobbyOpen(true);
                  setMobileSheetOpen(false);
                }}
                title="Play Online Multiplayer with friends or match with players worldwide"
              >
                🌐 Play Online
              </button>
              <button
                className="hud-btn"
                id="btn-side-toggle"
                title="Switch between Playing as White and Playing as Black"
                onClick={() => setMobileSheetOpen(false)}
              >
                Play as Black
              </button>
              <button
                className="hud-btn"
                id="btn-ai-move"
                title="Let the AI make the next move immediately"
                onClick={() => setMobileSheetOpen(false)}
              >
                AI Move
              </button>
              <button
                className="hud-btn"
                id="btn-reset"
                title="Start a fresh game on the altar"
                onClick={() => setMobileSheetOpen(false)}
              >
                New Game
              </button>
              <button
                className="hud-btn"
                title="Concede and resign current match"
                onClick={() => setConfirmResignOpen(true)}
              >
                🏳️ Resign
              </button>
              <button
                type="button"
                className="hud-btn"
                onClick={() => {
                  setSettingsModalOpen(true);
                  setMobileSheetOpen(false);
                }}
                title="Sanctum Audio & Display Settings"
              >
                ⚙️ Settings
              </button>
              <button
                className="hud-btn"
                title="View Computer Keyboard Shortcuts [?]"
                onClick={() => setShortcutsModalOpen(true)}
              >
                ⌨️ Keys
              </button>
            </div>
          ) : (
            /* Live Match Clean Toolbar */
            <div className="live-actions-bar">
              <button
                className={`hud-btn live-action-btn ${chatOpen ? 'active' : ''}`}
                onClick={() => {
                  setChatOpen((prev) => !prev);
                  setMobileSheetOpen(false);
                  setMatchOptionsOpen(false);
                }}
                title="Open Live Match Chat & Quick Emotes [C]"
              >
                💬 Chat {unreadChatCount > 0 ? <span className="live-chat-badge">{unreadChatCount}</span> : ''}
              </button>

              <button
                className={`hud-btn live-action-btn ${voiceState.connected ? (voiceState.muted ? 'muted' : 'active') : ''}`}
                onClick={handleToggleVoice}
                title="Toggle WebRTC Microphone"
              >
                {voiceState.connected
                  ? voiceState.muted
                    ? '🔇 Mic Off'
                    : '🎙️ Mic On'
                  : '🎙️ Mic'}
              </button>

              <button
                className={`hud-btn live-action-btn ${voiceState.speakerMuted ? 'muted' : 'active'}`}
                onClick={handleToggleSpeaker}
                title="Toggle Opponent Speaker Audio"
              >
                {voiceState.speakerMuted ? '🔈 Speaker Off' : '🔊 Speaker On'}
              </button>

              <button
                className="hud-btn live-action-btn"
                onClick={() => onlineManager.offerDraw()}
                title="Offer a mutual draw to opponent"
                disabled={onlineState.drawOfferedByMe}
              >
                {onlineState.drawOfferedByMe ? '🤝 Offered' : '🤝 Draw'}
              </button>

              <button
                className="hud-btn live-action-btn live-resign-btn"
                onClick={() => setConfirmResignOpen(true)}
                title="Concede and resign the game"
              >
                🏳️ Resign
              </button>

              <button
                type="button"
                className="hud-btn live-action-btn"
                onClick={() => {
                  setSettingsModalOpen(true);
                  setMobileSheetOpen(false);
                }}
                title="Sound Adjustment & Settings"
              >
                ⚙️ Sound &amp; Settings
              </button>

              <button
                className="hud-btn live-action-btn"
                onClick={() => setShortcutsModalOpen(true)}
                title="View Computer Keyboard Shortcuts [?]"
              >
                ⌨️ Keys
              </button>

              {onlineState.status === 'ended' && (
                <button
                  className="hud-btn highlight-btn live-action-btn live-rematch-btn"
                  onClick={() => onlineManager.requestRematch()}
                  title="Request Rematch with swapped colors"
                >
                  {onlineState.rematchRequestedByMe ? '🔄 Rematch Sent' : '🔄 Rematch'}
                </button>
              )}
            </div>
          )}

          {/* Secondary Controls: In Solo mode renders inline; in Live Match mode renders inside a sleek Options popover */}
          <div className="match-options-container">
            {isOnlineActive && (
              <button
                type="button"
                className={`hud-btn live-action-btn options-btn ${matchOptionsOpen ? 'active' : ''}`}
                onClick={() => setMatchOptionsOpen((prev) => !prev)}
                title="Cameras & Settings"
              >
                ⚙️ Options
              </button>
            )}

            <div
              className={`hud-secondary-tray ${isOnlineActive ? 'live-popover' : 'inline-tray'} ${
                matchOptionsOpen ? 'open' : ''
              }`}
            >
              <div className="hud-divider" aria-hidden="true" style={{ display: isOnlineActive ? 'none' : 'block' }}></div>
              <div className="mobile-sheet-section-label">
                <span>Camera Perspectives</span>
                <span className="mobile-sheet-section-sub">Tap active view to flip</span>
              </div>

              <button
                className="hud-btn active"
                id="btn-cam-player"
                title="Player Camera (Click again to flip White / Black view)"
                onClick={() => {
                  if (isOnlineActive) setMatchOptionsOpen(false);
                }}
              >
                Player Cam
              </button>
              <button
                className="hud-btn"
                id="btn-cam-top"
                title="Overhead Board View (Click again to flip White / Black orientation)"
                onClick={() => {
                  if (isOnlineActive) setMatchOptionsOpen(false);
                }}
              >
                Overhead
              </button>
              <button
                className="hud-btn"
                id="btn-cam-side"
                title="Side Profile View (Click again to switch East / West side)"
                onClick={() => {
                  if (isOnlineActive) setMatchOptionsOpen(false);
                }}
              >
                Side
              </button>
              <button
                className="hud-btn"
                id="btn-cam-wide"
                title="Wide Cathedral View (Click again to switch North Rose / South Narthex)"
                onClick={() => {
                  if (isOnlineActive) setMatchOptionsOpen(false);
                }}
              >
                Cathedral
              </button>

              <div className="hud-divider" aria-hidden="true"></div>
              <div className="mobile-sheet-section-label">Atmosphere &amp; Display</div>

              <button
                className="hud-btn"
                id="btn-graphics-toggle"
                title="Cycle Graphics Quality (Fast 60fps / Smooth Balanced / Ultra)"
              >
                ⚡ Graphics: Smooth
              </button>
              <button
                className="hud-btn"
                id="btn-sound-toggle"
                title="Toggle Sound Effects (iOS Touch to Unmute)"
              >
                🔊 Sound: On
              </button>
              <button
                className="hud-btn"
                id="btn-hide-ui"
                title="Toggle HUD visibility (Shortcut: H)"
                onClick={() => {
                  setMobileSheetOpen(false);
                  if (isOnlineActive) setMatchOptionsOpen(false);
                }}
              >
                Hide UI [H]
              </button>

              {isOnlineActive && (
                <>
                  <div className="hud-divider" aria-hidden="true"></div>
                  <button
                    type="button"
                    className="hud-btn danger-leave-btn"
                    onClick={() => {
                      setMatchOptionsOpen(false);
                      handleLeaveRoom();
                    }}
                    title="Exit room and return to solo practice"
                  >
                    🚪 Leave Room
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom HUD */}
      <div id="hud-bottom">
        <div className={`hint-pill ${isOnlineActive ? 'live-hidden' : ''}`} id="controls-hint">
          <strong>Controls:</strong> Tap/Click Piece to Move &nbsp;•&nbsp; Drag: Orbit &nbsp;•&nbsp; Right-Drag: Pan &nbsp;•&nbsp; Scroll: Zoom &nbsp;•&nbsp; C: Chat &nbsp;•&nbsp; H: Hide UI
        </div>
        <div className="captured-pill" id="captured-tray"></div>
      </div>

      {/* Checkmate Sequence Overlay */}
      <div id="checkmate-overlay" role="status" aria-live="polite">
        <div className="checkmate-banner">
          <div className="checkmate-ornament">✦ &nbsp; Sanctum Judgment &nbsp; ✦</div>
          <div className="checkmate-crown" id="checkmate-crown">
            ♔
          </div>
          <div className="checkmate-title" id="checkmate-title">
            Checkmate
          </div>
          <div className="checkmate-rule"></div>
          <div className="checkmate-subtitle" id="checkmate-subtitle">
            White Triumphs • The Black King Has Fallen
          </div>
          <div className="checkmate-actions">
            <button className="checkmate-btn" id="btn-checkmate-replay">
              Replay King Fall
            </button>
            {isOnlineActive ? (
              <>
                <button
                  type="button"
                  className="checkmate-btn"
                  onClick={() => {
                    onlineManager.requestRematch();
                    document.getElementById('checkmate-overlay')?.classList.remove('visible');
                  }}
                >
                  Request Rematch
                </button>
                <button
                  type="button"
                  className="checkmate-btn highlight-btn"
                  style={{
                    background: 'linear-gradient(135deg, rgba(230,57,70,0.45), rgba(230,57,70,0.2))',
                    borderColor: '#e63946',
                    color: '#ff9999'
                  }}
                  onClick={() => {
                    document.getElementById('checkmate-overlay')?.classList.remove('visible');
                    handleLeaveRoom();
                  }}
                >
                  🚪 Exit to Solo
                </button>
                <button
                  type="button"
                  className="checkmate-btn"
                  onClick={() => {
                    document.getElementById('checkmate-overlay')?.classList.remove('visible');
                    handleLeaveRoom();
                    setLobbyOpen(true);
                  }}
                >
                  🏰 Sanctum Lobby
                </button>
              </>
            ) : (
              <button className="checkmate-btn" id="btn-checkmate-newgame">
                New Game
              </button>
            )}
            <button className="checkmate-btn secondary" id="btn-checkmate-dismiss">
              Dismiss
            </button>
          </div>
        </div>
      </div>

      {/* Floating Incoming Chat Message Banner (opponent notice) */}
      {incomingChatToast && !chatOpen && (
        <div
          className="incoming-chat-toast animate-slide-in"
          onClick={() => {
            setChatOpen(true);
            setIncomingChatToast(null);
          }}
          title="Click to open Sanctum Chat and reply"
        >
          <div className="toast-chat-avatar">💬</div>
          <div className="toast-chat-content">
            <div className="toast-chat-sender">
              {incomingChatToast.senderName} {incomingChatToast.isEmote ? 'chanted' : 'says'}:
            </div>
            <div className="toast-chat-text">{incomingChatToast.text}</div>
          </div>
          <span className="toast-chat-reply-hint">Reply ➤</span>
        </div>
      )}

      {/* Sanctum Matchmaking Lock Overlay */}
      {searchingMatch && (
        <div className="matchmaking-lock-overlay" role="dialog" aria-modal="true" aria-label="Searching for Opponent">
          <div className="matchmaking-lock-card">
            <div className="matchmaking-radar-wrap">
              <div className="radar-rings"></div>
              <div className="radar-sweep"></div>
              <div className="radar-core-icon">⚔️</div>
            </div>

            <div className="matchmaking-lock-title">Searching for Opponent...</div>
            <div className="matchmaking-lock-subtitle">
              {searchElapsed < 8
                ? 'Seeking a worthy duelist across the realm...'
                : searchElapsed < 16
                ? 'Scanning active sanctum chambers for challengers...'
                : 'Patience, mage — broadening spectral search...'}
            </div>

            <div className="matchmaking-lock-details">
              <span className="matchmaking-detail-chip">
                {quickTime === 'none' ? '♾️ Unlimited Time' : `⏱️ ${quickTime} Clock`}
              </span>
              <span className="matchmaking-detail-chip">
                {quickSide === 'random' ? '🎲 Random Side' : quickSide === 'w' ? '♔ White' : '♚ Black'}
              </span>
              {matchmakingExpanded && (
                <span className="matchmaking-detail-chip" style={{ borderColor: '#34d399', color: '#6ee7b7' }}>
                  🌐 Any Time Control
                </span>
              )}
            </div>

            <div className="matchmaking-timer-display">
              <span className="timer-label">Elapsed:</span>
              <span className="timer-val">{formatClock(searchElapsed)}</span>
            </div>

            {searchElapsed >= 8 && (
              <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {!matchmakingExpanded && (
                  <button
                    type="button"
                    className="hud-btn"
                    style={{
                      padding: '5px 12px',
                      fontSize: '0.76rem',
                      borderColor: 'rgba(212,175,55,0.6)',
                      color: '#f5d76e',
                      background: 'rgba(212,175,55,0.12)'
                    }}
                    onClick={() => {
                      setMatchmakingExpanded(true);
                      onlineManager.quickMatch('any', quickSide);
                      showToast('Broadened search to any time control!');
                    }}
                  >
                    ⚡ Expand to Any Time Control
                  </button>
                )}
                <button
                  type="button"
                  className="hud-btn"
                  style={{
                    padding: '5px 12px',
                    fontSize: '0.76rem',
                    borderColor: '#38bdf8',
                    color: '#bae6fd',
                    background: 'rgba(56,189,248,0.12)'
                  }}
                  onClick={() => {
                    handleCancelQuickMatch();
                    const win = window as any;
                    win.wizardChess?.resetChessBoard?.(true);
                    showToast('Started practice duel vs AI Master');
                  }}
                >
                  🤖 Play vs Sanctum AI Now
                </button>
              </div>
            )}

            <div className="matchmaking-lock-notice">
              🔒 The Sanctum is sealed while matchmaking is underway.
              <br />
              <span className="notice-sub">All board controls and moves remain locked until matched.</span>
            </div>

            <button
              type="button"
              className="hud-btn highlight-btn matchmaking-cancel-btn"
              onClick={handleCancelQuickMatch}
            >
              ✕ Cancel Matchmaking
            </button>
          </div>
        </div>
      )}

      {/* Sound Adjustment & Sanctum Settings Modal */}
      {settingsModalOpen && (
        <div className="modal-backdrop open" style={{ zIndex: 95 }}>
          <div className="modal-card settings-modal-card">
            <div className="modal-header">
              <h2 className="modal-title">⚙️ Sanctum Audio &amp; Display Settings</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSettingsModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body settings-modal-body">
              {/* Master Volume Section */}
              <div className="settings-section">
                <div className="settings-section-header">
                  <span className="settings-label">🔊 Master Sound Effects</span>
                  <span className="settings-val-badge">{Math.round(soundVolume * 100)}%</span>
                </div>
                <div className="volume-slider-row">
                  <span className="slider-icon">🔈</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={soundMuted ? 0 : soundVolume}
                    className="volume-slider"
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  />
                  <span className="slider-icon">🔊</span>
                  <button
                    type="button"
                    className={`hud-btn volume-mute-btn ${soundMuted ? 'muted' : ''}`}
                    onClick={handleToggleSoundMute}
                  >
                    {soundMuted ? '🔇 Unmute' : '🔊 Mute'}
                  </button>
                </div>
                <div className="settings-help-text">
                  Controls stone slides, piece combat crashes, and cathedral chimes.
                </div>
              </div>

              {/* WebRTC Voice Chat Speaker Volume Section */}
              <div className="settings-section">
                <div className="settings-section-header">
                  <span className="settings-label">🗣️ Opponent Voice Audio (Speaker)</span>
                  <span className="settings-val-badge">
                    {voiceState.speakerMuted ? 'Muted' : `${Math.round(voiceState.speakerVolume * 100)}%`}
                  </span>
                </div>
                <div className="volume-slider-row">
                  <span className="slider-icon">🔈</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={voiceState.speakerMuted ? 0 : voiceState.speakerVolume}
                    className="volume-slider"
                    onChange={(e) => handleVoiceSpeakerVolumeChange(parseFloat(e.target.value))}
                  />
                  <span className="slider-icon">🔊</span>
                  <button
                    type="button"
                    className={`hud-btn volume-mute-btn ${voiceState.speakerMuted ? 'muted' : ''}`}
                    onClick={handleToggleSpeaker}
                  >
                    {voiceState.speakerMuted ? '🔇 Unmute' : '🔊 Mute'}
                  </button>
                </div>
                <div className="settings-help-text">
                  Controls incoming opponent speech volume or deafens incoming audio.
                </div>
              </div>

              {/* Graphics Quality */}
              <div className="settings-section">
                <div className="settings-section-header">
                  <span className="settings-label">⚡ Graphics Quality</span>
                  <span className="settings-val-badge">{graphicsQuality.toUpperCase()}</span>
                </div>
                <div className="graphics-quality-grid">
                  <button
                    type="button"
                    className={`hud-btn ${graphicsQuality === 'fast' ? 'highlight-btn active-quality' : ''}`}
                    onClick={() => handleSetGraphics('fast')}
                  >
                    ⚡ Fast (60fps)
                  </button>
                  <button
                    type="button"
                    className={`hud-btn ${graphicsQuality === 'smooth' ? 'highlight-btn active-quality' : ''}`}
                    onClick={() => handleSetGraphics('smooth')}
                  >
                    💎 Smooth (Balanced)
                  </button>
                  <button
                    type="button"
                    className={`hud-btn ${graphicsQuality === 'ultra' ? 'highlight-btn active-quality' : ''}`}
                    onClick={() => handleSetGraphics('ultra')}
                  >
                    👑 Ultra (Max PBR)
                  </button>
                </div>
              </div>

              {/* Camera Presets */}
              <div className="settings-section">
                <div className="settings-section-header">
                  <span className="settings-label">🎥 Camera View Preset</span>
                </div>
                <div className="camera-presets-grid">
                  <button type="button" className="hud-btn" onClick={() => (window as any).wizardChess?.setCameraPreset?.('player')}>
                    Player [1]
                  </button>
                  <button type="button" className="hud-btn" onClick={() => (window as any).wizardChess?.setCameraPreset?.('top')}>
                    Overhead [2]
                  </button>
                  <button type="button" className="hud-btn" onClick={() => (window as any).wizardChess?.setCameraPreset?.('side')}>
                    Side [3]
                  </button>
                  <button type="button" className="hud-btn" onClick={() => (window as any).wizardChess?.setCameraPreset?.('cathedral')}>
                    Cathedral [4]
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ textAlign: 'center', padding: '12px' }}>
              <button
                type="button"
                className="hud-btn highlight-btn"
                onClick={() => setSettingsModalOpen(false)}
              >
                Save &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-Game Live Chat & Emotes Drawer */}
      <div className={`chat-drawer ${chatOpen ? 'open' : ''}`} role="dialog" aria-label="Live Match Chat">
        <div className="chat-mobile-handle-wrap" onClick={() => setChatOpen(false)}>
          <div className="chat-mobile-handle"></div>
        </div>

        <div className="chat-header">
          <div className="chat-header-info">
            <span className="chat-title">💬 Live Match Chat</span>
            {onlineState.roomCode && (
              <span className="chat-room-badge">Room {onlineState.roomCode}</span>
            )}
          </div>
          <button
            type="button"
            className="chat-close-btn"
            onClick={() => setChatOpen(false)}
            aria-label="Close Chat"
          >
            ✕
          </button>
        </div>

        <div className="chat-messages-wrap">
          {onlineState.chatMessages.length === 0 ? (
            <div className="chat-empty-state">
              <span className="empty-chat-icon">📜</span>
              <p>No messages yet in this duel.</p>
              <span className="empty-chat-hint">Send a quick battle chant or tap an emote below!</span>
            </div>
          ) : (
            onlineState.chatMessages.map((msg) => {
              const isMine =
                (msg.sender === 'w' && onlineState.playerColor === 'w') ||
                (msg.sender === 'b' && onlineState.playerColor === 'b');
              const isSystem = msg.sender === 'system';
              return (
                <div
                  key={msg.id}
                  className={`chat-bubble-row ${isMine ? 'mine' : ''} ${isSystem ? 'system' : ''}`}
                >
                  {!isMine && !isSystem && (
                    <div className={`chat-avatar ${msg.sender === 'w' ? 'white-avatar' : 'black-avatar'}`}>
                      {msg.sender === 'w' ? '♔' : '♚'}
                    </div>
                  )}

                  <div className={`chat-bubble ${isMine ? 'mine' : ''} ${isSystem ? 'system' : ''} ${msg.isEmote ? 'emote' : ''}`}>
                    {!isSystem && (
                      <div className="chat-msg-header">
                        <span className="chat-msg-author">
                          {isMine ? 'You' : msg.senderName}
                        </span>
                        <span className="chat-msg-time">
                          {new Date(msg.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )}
                    <div className="chat-msg-body">{msg.text}</div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={chatMessagesEndRef} />
        </div>

        {/* Quick Wizard Emotes Bar (Horizontal Scrollable Chips) */}
        <div className="chat-emotes-bar">
          <button type="button" className="chat-emote-btn" onClick={() => handleSendEmote('🧙‍♂️ Greetings, Mage!')}>
            🧙‍♂️ Greetings!
          </button>
          <button type="button" className="chat-emote-btn" onClick={() => handleSendEmote('⚔️ En Garde!')}>
            ⚔️ En Garde!
          </button>
          <button type="button" className="chat-emote-btn" onClick={() => handleSendEmote('🛡️ Well Defended!')}>
            🛡️ Well Defended!
          </button>
          <button type="button" className="chat-emote-btn" onClick={() => handleSendEmote('👑 Bold Move!')}>
            👑 Bold Move!
          </button>
          <button type="button" className="chat-emote-btn" onClick={() => handleSendEmote('🤝 Well Played!')}>
            🤝 Well Played!
          </button>
          <button type="button" className="chat-emote-btn" onClick={() => handleSendEmote('⏱️ Your Move!')}>
            ⏱️ Your Move!
          </button>
          <button type="button" className="chat-emote-btn" onClick={() => handleSendEmote('🔥 Nice Play!')}>
            🔥 Nice Play!
          </button>
        </div>

        <form className="chat-input-bar" onSubmit={handleSendChat}>
          <input
            type="text"
            className="chat-text-input"
            placeholder="Type a spell chant or message..."
            value={chatInput}
            maxLength={140}
            onChange={(e) => setChatInput(e.target.value)}
          />
          <button type="submit" className="chat-send-btn" disabled={!chatInput.trim()}>
            Send ➤
          </button>
        </form>
      </div>

      {/* Resignation Confirmation Modal */}
      {confirmResignOpen && (
        <div className="modal-backdrop open" style={{ zIndex: 90 }}>
          <div className="modal-card resign-confirm-card">
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: '#ff6b6b' }}>🏳️ Concede &amp; Resign Match?</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setConfirmResignOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center', padding: '16px 20px' }}>
              <p style={{ color: '#e2e8f0', fontSize: '0.92rem', marginBottom: '16px' }}>
                Are you sure you want to resign? Choose whether to exit immediately or stay in the room for a rematch.
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="hud-btn highlight-btn"
                  style={{
                    background: 'linear-gradient(135deg, rgba(230, 57, 70, 0.45), rgba(230, 57, 70, 0.2))',
                    borderColor: '#e63946',
                    color: '#ff9999',
                    padding: '8px 16px'
                  }}
                  onClick={() => handleConfirmResign(true)}
                  title="Resign and immediately return to Solo Sanctum"
                >
                  🚪 Resign &amp; Exit to Solo
                </button>
                <button
                  type="button"
                  className="hud-btn"
                  style={{
                    background: 'rgba(212, 175, 55, 0.15)',
                    borderColor: 'rgba(212, 175, 55, 0.45)',
                    color: '#f5d76e',
                    padding: '8px 16px'
                  }}
                  onClick={() => handleConfirmResign(false)}
                  title="Resign but remain in the room for rematch"
                >
                  🏳️ Resign &amp; Stay for Rematch
                </button>
                <button
                  type="button"
                  className="hud-btn"
                  style={{ padding: '8px 16px' }}
                  onClick={() => setConfirmResignOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password Prompt Modal for Protected Rooms */}
      {passwordModalOpen && (
        <div className="modal-backdrop open" style={{ zIndex: 98 }}>
          <div className="modal-card" style={{ maxWidth: 380 }}>
            <div className="modal-header">
              <h2 className="modal-title">🔒 Password Required</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => {
                  setPasswordModalOpen(false);
                  setPendingJoinRoomCode(null);
                  setJoinPasswordInput('');
                }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>
              <p style={{ color: '#cbd5e1', fontSize: '0.86rem', marginBottom: '14px' }}>
                Sanctum Room <strong style={{ color: '#f5d76e' }}>{pendingJoinRoomCode}</strong> is password protected. Enter the passcode:
              </p>
              <input
                type="password"
                placeholder="Enter room password..."
                value={joinPasswordInput}
                onChange={(e) => setJoinPasswordInput(e.target.value)}
                maxLength={16}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pendingJoinRoomCode) {
                    handleJoinByCode(pendingJoinRoomCode, joinPasswordInput);
                  }
                }}
                style={{
                  width: '100%',
                  background: '#0a0d14',
                  border: '1px solid rgba(212,175,55,0.4)',
                  borderRadius: '6px',
                  color: '#f0ece1',
                  padding: '9px 12px',
                  fontSize: '0.95rem',
                  marginBottom: '16px'
                }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="modal-primary-btn"
                  style={{ flex: 1, margin: 0, padding: '10px' }}
                  onClick={() => {
                    if (pendingJoinRoomCode) {
                      handleJoinByCode(pendingJoinRoomCode, joinPasswordInput);
                    }
                  }}
                >
                  Unlock &amp; Join
                </button>
                <button
                  type="button"
                  className="modal-secondary-btn"
                  onClick={() => {
                    setPasswordModalOpen(false);
                    setPendingJoinRoomCode(null);
                    setJoinPasswordInput('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Guide Modal for Computer Players */}
      {shortcutsModalOpen && (
        <div className="modal-backdrop open" style={{ zIndex: 90 }}>
          <div className="modal-card shortcuts-modal-card">
            <div className="modal-header">
              <h2 className="modal-title">⌨️ Computer Keyboard Controls</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShortcutsModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body shortcuts-modal-body">
              <div className="shortcuts-category">
                <div className="shortcuts-cat-title">♟️ Board Navigation &amp; Moving</div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></div>
                  <div className="shortcut-desc">Move Cursor on Board</div>
                </div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>Space</kbd> / <kbd>Enter</kbd></div>
                  <div className="shortcut-desc">Select Piece / Confirm Move</div>
                </div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd></div>
                  <div className="shortcut-desc">Cycle Movable Pieces</div>
                </div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>Esc</kbd></div>
                  <div className="shortcut-desc">Cancel Selection / Clear Cursor</div>
                </div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>A</kbd>-<kbd>H</kbd> + <kbd>1</kbd>-<kbd>8</kbd></div>
                  <div className="shortcut-desc">Direct Coordinate (e.g. <kbd>e</kbd> then <kbd>4</kbd> = e4)</div>
                </div>
              </div>

              <div className="shortcuts-category">
                <div className="shortcuts-cat-title">🎥 Camera &amp; Views</div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></div>
                  <div className="shortcut-desc">Player / Overhead / Side / Cathedral Camera</div>
                </div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> + <kbd>R</kbd>/<kbd>F</kbd></div>
                  <div className="shortcut-desc">Fly &amp; Pan Camera</div>
                </div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>Shift</kbd> + Arrows</div>
                  <div className="shortcut-desc">Orbit / Rotate Camera</div>
                </div>
              </div>

              <div className="shortcuts-category">
                <div className="shortcuts-cat-title">⚡ Match &amp; Atmosphere</div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>G</kbd></div>
                  <div className="shortcut-desc">Graphics Quality (Fast / Smooth / Ultra)</div>
                </div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>M</kbd></div>
                  <div className="shortcut-desc">Sound Effects (Mute / Unmute)</div>
                </div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>U</kbd> / <kbd>H</kbd></div>
                  <div className="shortcut-desc">Toggle Minimal UI (Cinematic View)</div>
                </div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>C</kbd></div>
                  <div className="shortcut-desc">Toggle Live Chat</div>
                </div>
                <div className="shortcut-row">
                  <div className="shortcut-keys"><kbd>?</kbd> / <kbd>K</kbd></div>
                  <div className="shortcut-desc">Open / Close This Guide</div>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ textAlign: 'center', padding: '12px' }}>
              <button
                type="button"
                className="hud-btn highlight-btn"
                style={{ padding: '6px 20px' }}
                onClick={() => setShortcutsModalOpen(false)}
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Online Multiplayer & Director Script Lobby Modal */}
      {lobbyOpen && (
        <div id="lobby-modal" className="modal-backdrop open">
          <div className="modal-card">
            <div className="modal-header">
              <h2 className="modal-title">🏰 Wizard Chess Sanctum Lobby</h2>
              <button
                type="button"
                className="modal-close"
                id="btn-close-lobby"
                onClick={() => setLobbyOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-tabs">
              <button
                type="button"
                className={`modal-tab ${lobbyTab === 'quick' ? 'active' : ''}`}
                onClick={() => setLobbyTab('quick')}
              >
                ⚡ Quick Match
              </button>
              <button
                type="button"
                className={`modal-tab ${lobbyTab === 'custom' ? 'active' : ''}`}
                onClick={() => setLobbyTab('custom')}
              >
                🏰 Custom Room
              </button>
              <button
                type="button"
                className={`modal-tab ${lobbyTab === 'join' ? 'active' : ''}`}
                onClick={() => setLobbyTab('join')}
              >
                🔎 Join Room
              </button>
              <button
                type="button"
                className={`modal-tab ${lobbyTab === 'single' ? 'active' : ''}`}
                onClick={() => setLobbyTab('single')}
              >
                🤖 Solo vs AI
              </button>
              <button
                type="button"
                className={`modal-tab ${lobbyTab === 'script' ? 'active' : ''}`}
                onClick={() => setLobbyTab('script')}
              >
                📜 Director Script
              </button>
            </div>

            <div className="modal-body">
              {/* TAB 1: QUICK MATCH */}
              {lobbyTab === 'quick' && (
                <div className="modal-panel">
                  {!searchingMatch ? (
                    <>
                      <div className="modal-section-title">Select Time Control</div>
                      <div className="color-picker-grid">
                        <button
                          type="button"
                          className={`color-pick-btn ${quickTime === 'none' ? 'selected' : ''}`}
                          onClick={() => setQuickTime('none')}
                        >
                          ♾️ Unlimited
                        </button>
                        <button
                          type="button"
                          className={`color-pick-btn ${quickTime === '3m' ? 'selected' : ''}`}
                          onClick={() => setQuickTime('3m')}
                        >
                          ⚡ 3 Min Blitz
                        </button>
                        <button
                          type="button"
                          className={`color-pick-btn ${quickTime === '5m' ? 'selected' : ''}`}
                          onClick={() => setQuickTime('5m')}
                        >
                          ⏱️ 5 Min Rapid
                        </button>
                        <button
                          type="button"
                          className={`color-pick-btn ${quickTime === '10m' ? 'selected' : ''}`}
                          onClick={() => setQuickTime('10m')}
                        >
                          ⏳ 10 Min Classic
                        </button>
                      </div>

                      <div className="modal-section-title" style={{ marginTop: '14px' }}>
                        Preferred Side
                      </div>
                      <div className="color-picker-grid">
                        <button
                          type="button"
                          className={`color-pick-btn ${quickSide === 'random' ? 'selected' : ''}`}
                          onClick={() => setQuickSide('random')}
                        >
                          🎲 Random
                        </button>
                        <button
                          type="button"
                          className={`color-pick-btn ${quickSide === 'w' ? 'selected' : ''}`}
                          onClick={() => setQuickSide('w')}
                        >
                          ♔ White
                        </button>
                        <button
                          type="button"
                          className={`color-pick-btn ${quickSide === 'b' ? 'selected' : ''}`}
                          onClick={() => setQuickSide('b')}
                        >
                          ♚ Black
                        </button>
                      </div>

                      <button
                        type="button"
                        className="modal-primary-btn"
                        onClick={handleStartQuickMatch}
                        style={{ marginTop: '18px', padding: '12px' }}
                      >
                        ⚡ Find Match Now
                      </button>
                    </>
                  ) : (
                    <div className="radar-box">
                      <div className="radar-circle">
                        <div className="radar-pulse"></div>
                        ⚡
                      </div>
                      <div style={{ color: '#f5d76e', fontWeight: 600, fontSize: '0.95rem' }}>
                        Summoning Opponent...
                      </div>
                      <div style={{ color: '#9aa0a6', fontSize: '0.8rem', textAlign: 'center' }}>
                        Searching for an active sanctum match with{' '}
                        {quickTime === 'none' ? 'Unlimited' : quickTime} time control.
                      </div>
                      <button
                        type="button"
                        className="modal-secondary-btn"
                        onClick={handleCancelQuickMatch}
                        style={{ marginTop: '12px' }}
                      >
                        Cancel Search
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: CUSTOM ROOM */}
              {lobbyTab === 'custom' && (
                <div className="modal-panel">
                  <div className="modal-section-title">Your Wizard Name</div>
                  <input
                    type="text"
                    value={onlineState.playerName}
                    onChange={(e) => onlineManager.setPlayerName(e.target.value)}
                    maxLength={24}
                    style={{
                      width: '100%',
                      background: '#0a0d14',
                      border: '1px solid rgba(212,175,55,0.4)',
                      borderRadius: '6px',
                      color: '#f0ece1',
                      padding: '8px 12px',
                      fontSize: '0.9rem',
                      marginBottom: '14px'
                    }}
                  />

                  <div className="modal-section-title">Select Your Side</div>
                  <div className="color-picker-grid">
                    <button
                      type="button"
                      className={`color-pick-btn ${customColor === 'w' ? 'selected' : ''}`}
                      onClick={() => setCustomColor('w')}
                    >
                      ♔ White (Host Moves First)
                    </button>
                    <button
                      type="button"
                      className={`color-pick-btn ${customColor === 'b' ? 'selected' : ''}`}
                      onClick={() => setCustomColor('b')}
                    >
                      ♚ Black (Guest Moves First)
                    </button>
                  </div>

                  <div className="modal-section-title" style={{ marginTop: '14px' }}>
                    Match Clock
                  </div>
                  <div className="color-picker-grid">
                    <button
                      type="button"
                      className={`color-pick-btn ${customTime === 'none' ? 'selected' : ''}`}
                      onClick={() => setCustomTime('none')}
                    >
                      ♾️ Unlimited
                    </button>
                    <button
                      type="button"
                      className={`color-pick-btn ${customTime === '3m' ? 'selected' : ''}`}
                      onClick={() => setCustomTime('3m')}
                    >
                      ⚡ 3m Blitz
                    </button>
                    <button
                      type="button"
                      className={`color-pick-btn ${customTime === '5m' ? 'selected' : ''}`}
                      onClick={() => setCustomTime('5m')}
                    >
                      ⏱️ 5m Rapid
                    </button>
                    <button
                      type="button"
                      className={`color-pick-btn ${customTime === '10m' ? 'selected' : ''}`}
                      onClick={() => setCustomTime('10m')}
                    >
                      ⏳ 10m Classic
                    </button>
                  </div>

                  <button
                    type="button"
                    className="modal-primary-btn"
                    onClick={handleCreateCustomRoom}
                    style={{ marginTop: '16px' }}
                  >
                    🏰 Create Sanctum Room
                  </button>

                  {createdRoomCode && (
                    <div
                      style={{
                        marginTop: '14px',
                        padding: '12px',
                        background: 'rgba(212,175,55,0.08)',
                        borderRadius: '8px',
                        border: '1px solid rgba(212,175,55,0.3)'
                      }}
                    >
                      <div style={{ fontSize: '0.85rem', color: '#f0ece1', marginBottom: '8px' }}>
                        Room Code:{' '}
                        <strong style={{ color: '#f5d76e', fontSize: '1.2rem', fontFamily: 'monospace' }}>
                          {createdRoomCode}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="modal-secondary-btn"
                          onClick={() => {
                            navigator.clipboard?.writeText(createdRoomCode);
                            showToast(`Copied code ${createdRoomCode}!`);
                          }}
                        >
                          Copy Code
                        </button>
                        <button
                          type="button"
                          className="modal-secondary-btn"
                          onClick={() => {
                            const link = `${window.location.origin}${window.location.pathname}?room=${createdRoomCode}`;
                            navigator.clipboard?.writeText(link);
                            showToast('Copied invite link to clipboard!');
                          }}
                        >
                          Copy Invite Link
                        </button>
                        <button
                          type="button"
                          className="modal-primary-btn"
                          style={{ flex: 1, margin: 0, padding: '6px 12px' }}
                          onClick={() => setLobbyOpen(false)}
                        >
                          Enter Room
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: JOIN ROOM & PUBLIC ROOMS */}
              {lobbyTab === 'join' && (
                <div className="modal-panel">
                  <div className="modal-section-title">Enter 4-Character Room Code</div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="e.g. A4K9"
                      maxLength={6}
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                      style={{
                        flex: 1,
                        background: '#0a0d14',
                        border: '1px solid rgba(212,175,55,0.4)',
                        borderRadius: '6px',
                        color: '#f0ece1',
                        padding: '8px 12px',
                        fontSize: '0.95rem',
                        textTransform: 'uppercase',
                        fontFamily: 'monospace'
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleJoinByCode(joinCodeInput);
                      }}
                    />
                    <button
                      type="button"
                      className="modal-primary-btn"
                      style={{ margin: 0, padding: '8px 18px', width: 'auto' }}
                      onClick={() => handleJoinByCode(joinCodeInput)}
                    >
                      Join
                    </button>
                  </div>

                  <div
                    style={{
                      marginTop: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div className="modal-section-title" style={{ margin: 0 }}>
                      Live Open Sanctums ({publicRooms.length})
                    </div>
                    <button
                      type="button"
                      className="modal-secondary-btn"
                      style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                      onClick={refreshPublicRooms}
                    >
                      🔄 Refresh
                    </button>
                  </div>

                  {publicRooms.length === 0 ? (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: '20px 0',
                        color: '#9aa0a6',
                        fontSize: '0.8rem'
                      }}
                    >
                      No public rooms waiting right now. Create one above or use Quick Match!
                    </div>
                  ) : (
                    <table className="public-rooms-table">
                      <thead>
                        <tr>
                          <th>Room</th>
                          <th>Host</th>
                          <th>Clock</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {publicRooms.map((r) => (
                          <tr key={r.code}>
                            <td style={{ fontFamily: 'monospace', color: '#f5d76e', fontWeight: 600 }}>
                              {r.code}
                            </td>
                            <td>{r.whiteName !== 'Waiting...' ? r.whiteName : r.blackName}</td>
                            <td>{r.timeControl === 'none' ? 'Unlimited' : r.timeControl}</td>
                            <td>
                              <button
                                type="button"
                                className="modal-secondary-btn"
                                style={{ padding: '3px 10px', fontSize: '0.72rem' }}
                                onClick={() => handleJoinByCode(r.code)}
                              >
                                Join
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* TAB 4: SOLO VS AI */}
              {lobbyTab === 'single' && (
                <div className="modal-panel">
                  <div className="modal-section-title">Select Your Side</div>
                  <div className="color-picker-grid">
                    <button
                      type="button"
                      className="color-pick-btn selected"
                      id="pick-sp-white"
                      onClick={() => {
                        const win = window as any;
                        win.wizardChess?.setSinglePlayerSide?.('w');
                        setLobbyOpen(false);
                      }}
                    >
                      ♔ White (Play First)
                    </button>
                    <button
                      type="button"
                      className="color-pick-btn"
                      id="pick-sp-black"
                      onClick={() => {
                        const win = window as any;
                        win.wizardChess?.setSinglePlayerSide?.('b');
                        setLobbyOpen(false);
                      }}
                    >
                      ♚ Black (AI Plays First)
                    </button>
                  </div>
                  <button
                    type="button"
                    className="modal-primary-btn"
                    onClick={() => {
                      const win = window as any;
                      win.wizardChess?.resetChessBoard?.(true);
                      setLobbyOpen(false);
                    }}
                    style={{ marginTop: '16px' }}
                  >
                    Start Single Player Game
                  </button>
                </div>
              )}

              {/* TAB 5: DIRECTOR SCRIPT */}
              {lobbyTab === 'script' && (
                <div className="modal-panel">
                  <div className="modal-section-title">Historic PGN / SAN Notation Script</div>
                  <textarea
                    id="input-notation"
                    rows={4}
                    placeholder="1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5..."
                    defaultValue="1. e4 d5 2. exd5 Qxd5 3. Nc3 Qd8 4. d4 c6 5. Bc4 h6 6. Nf3 Bg4 7. Bxf7+ Kxf7 8. Ne5+ Ke8 9. Qxg4 Nf6 10. Qg6#"
                    style={{
                      width: '100%',
                      background: '#0a0d14',
                      border: '1px solid rgba(212,175,55,0.4)',
                      borderRadius: '6px',
                      color: '#f0ece1',
                      padding: '8px 12px',
                      fontSize: '0.85rem',
                      fontFamily: 'monospace',
                      resize: 'vertical'
                    }}
                  ></textarea>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      type="button"
                      className="modal-secondary-btn"
                      onClick={() => {
                        const el = document.getElementById('input-notation') as HTMLTextAreaElement;
                        if (el)
                          el.value =
                            '1. e4 d5 2. exd5 Qxd5 3. Nc3 Qd8 4. d4 c6 5. Bc4 h6 6. Nf3 Bg4 7. Bxf7+ Kxf7 8. Ne5+ Ke8 9. Qxg4 Nf6 10. Qg6#';
                      }}
                    >
                      Scand. Defense
                    </button>
                    <button
                      type="button"
                      className="modal-secondary-btn"
                      onClick={() => {
                        const el = document.getElementById('input-notation') as HTMLTextAreaElement;
                        if (el)
                          el.value =
                            '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+';
                      }}
                    >
                      Italian Game
                    </button>
                    <button
                      type="button"
                      className="modal-secondary-btn"
                      onClick={() => {
                        const el = document.getElementById('input-notation') as HTMLTextAreaElement;
                        if (el) el.value = '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#';
                      }}
                    >
                      Scholar's Mate
                    </button>
                  </div>
                  <button
                    type="button"
                    className="modal-primary-btn"
                    style={{ marginTop: '14px' }}
                    onClick={() => {
                      const el = document.getElementById('input-notation') as HTMLTextAreaElement;
                      const win = window as any;
                      if (el && win.wizardChess?.loadNotation) {
                        const res = win.wizardChess.loadNotation(el.value, { orientCamera: false });
                        if (res && res.ok) {
                          setLobbyOpen(false);
                          showToast(`Loaded ${res.count} half-moves! Use [ and ] to step.`);
                        }
                      }
                    }}
                  >
                    Load &amp; Step Script
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
