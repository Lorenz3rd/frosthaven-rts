// Network settings: how players' PCs find a path to the host (see net.js). Safe to edit.
//
// Paths, in the order they're tried at once:
//   - Same network: PCs on one Wi-Fi, on a PC's hotspot or joined by a cable connect directly. This needs
//     "Same network" (Connection settings, on by default) and the microphone allowed on at least one of
//     the two PCs, ideally the host's: browsers only share a PC's local addresses with pages that have it.
//   - Over the internet: the STUN servers below tell each PC its public address so the two can get
//     through their routers. Works between most homes and phone hotspots.
//   - A TURN relay passes the game traffic along when neither works (strict school or work Wi-Fi, some
//     mobile carriers, a router that blocks it). No free relay works without an account any more, so the
//     easiest place for one is the game itself: Network Multiplayer › Connection settings › Relay server,
//     on the host's PC (it stays on that PC, out of the shared files). "Test relay" checks it.
//     Or list it in `turn` below for every PC that has these files. Anyone with the files can read
//     credentials put here, so don't reuse a password from anything else.
(function (G) {
  G.NET_CONFIG = {
    stun: [
      'stun:stun.l.google.com:19302',
      'stun:stun.cloudflare.com:3478'
    ],
    turn: [
      // { urls: ['turn:global.relay.metered.ca:80', 'turn:global.relay.metered.ca:80?transport=tcp',
      //          'turn:global.relay.metered.ca:443', 'turns:global.relay.metered.ca:443?transport=tcp'],
      //   username: 'YOUR-USERNAME', credential: 'YOUR-CREDENTIAL' }
    ],
    // Testing only: true sends everything through the TURN relay (as the strictest networks would).
    forceRelay: false
  };
})(window.Game);
