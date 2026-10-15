// Network settings: how players' PCs find a path to the host (see net.js). Safe to edit.
//
// Players on the same Wi-Fi connect straight across it. Players on different networks (different homes,
// a phone hotspot...) usually connect straight over the internet too: the STUN servers below tell each
// PC its public address so the two can get through their routers. Some networks (strict school or work
// Wi-Fi, some mobile carriers, a few home routers) block that; those players need a TURN relay server,
// which passes the game traffic along for them. No free relay works without an account any more, so
// `turn` starts empty. If a player sees "Found the room, but couldn't connect to the host's PC", add one:
//
//   1. Make a free account at https://www.metered.ca/stun-turn ("Open Relay": a monthly free allowance;
//      one 6-player game uses roughly 0.5 GB an hour per relayed player).
//   2. In its dashboard, copy your TURN username and credential into the entries below and uncomment them.
//   3. Give everyone the same netconfig.js (the host's copy matters most: a relay on the host's side is
//      usually enough for every player to reach it).
// Note: anyone with the game files can read these credentials. That's normal for a game among friends;
// don't reuse a password from anything else.
(function (G) {
  G.NET_CONFIG = {
    stun: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
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
