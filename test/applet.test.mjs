import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();

test('Online Playing System and Essential HUD in src/App.tsx are complete and verified', () => {
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');

  // Must include essential game & camera controls
  for (const requiredId of [
    'btn-side-toggle',
    'btn-ai-move',
    'btn-reset',
    'btn-cam-player',
    'btn-cam-top',
    'btn-cam-side',
    'btn-cam-wide',
    'btn-hide-ui',
    'controls-hint',
    'captured-tray'
  ]) {
    assert.ok(appTsx.includes(`id="${requiredId}"`), `Missing required HUD control #${requiredId}`);
  }

  // Must include online playing components
  assert.ok(appTsx.includes('onlineManager'), 'Missing onlineManager integration in App.tsx');
  assert.ok(appTsx.includes('Quick Match'), 'Missing Quick Match in App.tsx');
  assert.ok(appTsx.includes('chat-drawer'), 'Missing live chat drawer in App.tsx');
  assert.ok(appTsx.includes('player-clock-card'), 'Missing chess clock cards in App.tsx');
});

test('Online Multiplayer Server endpoints and WebSocket logic are present in server.ts', () => {
  const serverTs = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf-8');

  assert.ok(serverTs.includes("path: '/ws'"), 'Missing WebSocket endpoint on /ws');
  assert.ok(serverTs.includes('/api/rooms/create'), 'Missing /api/rooms/create endpoint');
  assert.ok(serverTs.includes('/api/rooms'), 'Missing /api/rooms endpoint');
  assert.ok(serverTs.includes('quick_match'), 'Missing quick_match WebSocket handler');
  assert.ok(serverTs.includes('rematch_request'), 'Missing rematch_request WebSocket handler');
  assert.ok(serverTs.includes('draw_offer'), 'Missing draw_offer WebSocket handler');
});

test('All 7 compressed 3D assets (.glb.gz.b64) decode and gunzip to valid glTF 2.0 binary models', () => {
  const expectedModels = [
    'option8_cathedral',
    'pawn_white',
    'rook_white',
    'knight_white',
    'bishop_white',
    'queen_white',
    'king_white'
  ];

  for (const name of expectedModels) {
    const b64Path = path.join(ROOT, 'public/assets/glb', `${name}.glb.gz.b64`);
    assert.ok(fs.existsSync(b64Path), `Missing 3D asset ${b64Path}`);
    const b64Text = fs.readFileSync(b64Path, 'utf-8').trim();
    assert.ok(b64Text.length > 1000, `Asset ${name}.glb.gz.b64 is unexpectedly small`);

    const gzBuf = Buffer.from(b64Text, 'base64');
    const glbBuf = zlib.gunzipSync(gzBuf);

    const magic = glbBuf.toString('ascii', 0, 4);
    const version = glbBuf.readUInt32LE(4);
    const totalLen = glbBuf.readUInt32LE(8);
    assert.equal(magic, 'glTF', `Invalid glTF magic header for ${name}`);
    assert.equal(version, 2, `Invalid glTF version for ${name}`);
    assert.equal(totalLen, glbBuf.length, `Mismatched glTF byte length for ${name}`);
  }
});

test('All 3 Graphics Quality Tiers (Fast, Smooth, Ultra) are fully implemented and optimized in wizardChessEngine.js', () => {
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');

  // Verify presence of quality definitions
  assert.ok(engineJs.includes("['fast', 'smooth', 'ultra']"), 'Missing graphics tiers array');
  assert.ok(engineJs.includes('setGraphicsQuality'), 'Missing setGraphicsQuality function');
  assert.ok(engineJs.includes('cycleGraphicsQuality'), 'Missing cycleGraphicsQuality function');
  assert.ok(engineJs.includes('applyAnisotropyToAllTextures'), 'Missing anisotropic filtering optimization');

  // Verify fast tier optimizations (shadows disabled, 1.0 pixel ratio, zero-cost debris)
  assert.ok(engineJs.includes("quality === 'fast'"), 'Missing fast tier handling');
  assert.ok(engineJs.includes('renderer.shadowMap.enabled = false'), 'Fast mode must disable shadow maps');

  // Verify smooth tier optimizations (1024 shadow map, 1.35 pixel ratio, 4x anisotropy)
  assert.ok(engineJs.includes('keyLight.shadow.mapSize.width = 1024'), 'Smooth mode must use 1024 shadow map');

  // Verify ultra tier optimizations (2048 shadow map, 2.0 pixel ratio, 16x/max anisotropy, smooth updates)
  assert.ok(engineJs.includes('keyLight.shadow.mapSize.width = 2048'), 'Ultra mode must use 2048 shadow map');
  assert.ok(engineJs.includes("currentGraphicsQuality === 'ultra'"), 'Missing ultra tier condition in render loop');
});

test('Matchmaking UI locks background UI, Voice mic/speaker buttons, Sound Adjust in settings, Chat notification and English UI', () => {
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  const stylesCss = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf-8');
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  const soundJs = fs.readFileSync(path.join(ROOT, 'src/soundEffects.js'), 'utf-8');
  const voiceTs = fs.readFileSync(path.join(ROOT, 'src/voiceChat.ts'), 'utf-8');

  // 1. Matchmaking UI Lock
  assert.ok(appTsx.includes('matchmaking-active-locked'), 'App.tsx must apply matchmaking-active-locked class');
  assert.ok(appTsx.includes('matchmaking-lock-overlay'), 'App.tsx must render matchmaking lock overlay');
  assert.ok(stylesCss.includes('body.matchmaking-active-locked #canvas-container'), 'styles.css must lock canvas during matchmaking');
  assert.ok(engineJs.includes('isMatchmakingLocked'), 'wizardChessEngine.js must guard against moves when matchmaking is locked');

  // 2. Voice Mic and Speaker Buttons
  assert.ok(voiceTs.includes('speakerMuted'), 'voiceChat.ts must have speakerMuted state');
  assert.ok(voiceTs.includes('toggleSpeaker'), 'voiceChat.ts must have toggleSpeaker method');
  assert.ok(appTsx.includes('handleToggleVoice'), 'App.tsx must have mic toggle handler');
  assert.ok(appTsx.includes('handleToggleSpeaker'), 'App.tsx must have speaker toggle handler');

  // 3. Sound Adjustment in Settings
  assert.ok(soundJs.includes('setVolume'), 'soundEffects.js must have setVolume method');
  assert.ok(soundJs.includes('getVolume'), 'soundEffects.js must have getVolume method');
  assert.ok(appTsx.includes('settingsModalOpen'), 'App.tsx must have settingsModalOpen state');
  assert.ok(appTsx.includes('volume-slider'), 'App.tsx must render volume slider');
  assert.ok(appTsx.includes('handleVolumeChange'), 'App.tsx must have volume change handler');
  assert.ok(appTsx.includes('handleVoiceSpeakerVolumeChange'), 'App.tsx must have speaker volume change handler');

  // 4. Opponent Message Notification
  assert.ok(soundJs.includes('playChatNotificationSound'), 'soundEffects.js must have playChatNotificationSound');
  assert.ok(appTsx.includes('incoming-chat-toast'), 'App.tsx must render incoming-chat-toast notification');
  assert.ok(appTsx.includes('unreadChatCount'), 'App.tsx must track unreadChatCount');

  // 5. English UI Language - no Bengali characters in src/App.tsx
  const bengaliRegex = /[\u0980-\u09FF]/;
  assert.ok(!bengaliRegex.test(appTsx), 'src/App.tsx must be in English with no Bengali characters');

  // 6. Mobile Responsiveness
  assert.ok(stylesCss.includes('@media (max-width: 768px)'), 'styles.css must include mobile responsive media query');
  assert.ok(stylesCss.includes('#hud-right.mobile-sheet-open'), 'styles.css must have mobile sheet styles');
  assert.ok(stylesCss.includes('.chat-drawer'), 'styles.css must style chat drawer for mobile');
});

