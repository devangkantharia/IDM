// config.js
//
//  Copyright 2014 Regents of the University of California
//  For licensing details see the LICENSE file.
//
//  Author:  Zhehao Wang

Config = {
  // Face configuration, as connectivity to default WS on NDN testbed is not necessary
  hostName					: "192.168.100.101",
  wsPort					: 0,
  
  // Namespace configuration
  rootPrefix				: "/ndn/edu/ucla/remap/opt",
  spaceName					: "node0",
  
  // Interest configuration
  initialReexpressInterval	: 1000,
  defaultInitialLifetime	: 2000,
  defaultTrackLifetime		: 150,
  defaultHintLifetime		: 50000,
  
  // The threshold for number of timeouts received in a row to decide not to fetch certain
  // track anymore
  trackTimeoutThreshold		: 5
};

ProducerNameComponents = {
  tracks		: "tracks",
  trackHint		: "track_hint",
  trackIdOffset	: -2,
  trackSeqOffset : -1
};

exports.Config = Config;
exports.ProducerNameComponents = ProducerNameComponents;