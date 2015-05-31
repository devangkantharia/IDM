// consumer.js
//
//  Copyright 2015 Regents of the University of California
//  For licensing details see the LICENSE file.
//
//  Author:  Zhehao Wang; Peter Gusev
//  March 29 8PM version with producer modifications on application PIT.

// TODO: hinttimeout needs to be better handled.

/**
 * Consumer creates a consumer for ndn-opt; The consumer follows the protocol
 * described here: https://github.com/named-data/ndn-opt/tree/master/publisher
 * Multithread access of consumer is not taken care of in this implementation.
 *
 * @param {Face} The websocket face which consumer uses;
 * @param {Name} The [root] prefix that producer uses; Before [space_name] component;
 * @param {Name} The [space_name] prefix that producer uses; Full prefix = [root]/[space_name]
 * @param {function(decoded JSON object)} Function called whenever the consumer fetched track data
 */

var Face = require('ndn-js').Face;
var Name = require('ndn-js').Name;

var Interest = require('ndn-js').Interest;
var Data = require('ndn-js').Data;
var Exclude = require('ndn-js').Exclude;

var PipelineSize = 3;

var Consumer = function(face, root, spaceName, displayCallback)
{
  this.face = face;
  this.prefix = new Name(root);
  this.prefix.append(spaceName);
  
  this.startTimeComponent = new Name.Component();
  // this records the indices of the tracks that have been active since the start of this run.
  this.activeTracks = {};
  
  // JB - commented out as it will generate a significant memory leak 
  // All fetched track data is stored in this array: may want to organize it.
  // Are we expecting a large number of entries, which means I should flush this array at some point?
  //this.trackData = [];
  
  // Display callback is called once track data is received
  this.displayCallback = displayCallback;
};

// Expected data name: [root]/opt/[node_num]/[start_timestamp]/tracks/[track_num]/[seq_num]
Consumer.prototype.onTrackData = function(interest, data)
{
  var trackId = data.getName().get
    (ProducerNameComponents.trackIdOffset).toEscapedString();
  var receivedSeq = parseInt(data.getName().get(-1).toEscapedString());

  if (!this.activeTracks[trackId])
  {
    console.log("onData: no data for " + trackId);
    return ;
  }
  
  if (receivedSeq > this.activeTracks[trackId].lastReceivedSeq)
  {
    this.activeTracks[trackId].lastReceivedSeq = receivedSeq;
    var moreInterests = PipelineSize + receivedSeq - this.activeTracks[trackId].lastIssuedSeq;
    
    if (moreInterests != 0)
    {
      var trackName = new Name(data.getName().getPrefix(-1));
      var startSeq = this.activeTracks[trackId].lastIssuedSeq;
      var endSeq = this.activeTracks[trackId].lastIssuedSeq + moreInterests;
      this.activeTracks[trackId].lastIssuedSeq = endSeq;
      this.pipeline(trackName, startSeq, endSeq)
    }
  }
  else
  {
    console.log("data out of date, received seq " + receivedSeq + "; last received seq " + this.activeTracks[trackId].lastReceivedSeq);
    // out-dated data, don't bother
    return ; 
  }
  
  var parsedTrack = JSON.parse(data.getContent().buf());
  //this.trackData.push(parsedTrack);

  if (this.displayCallback) {
    this.displayCallback(parsedTrack);
  }

  if (this.activeTracks[trackId] != undefined) {
    this.activeTracks[trackId].timeoutCnt = 0;
  }
  else {
  this.activeTracks[trackId].timeoutCnt = 0;
  } 
};

Consumer.prototype.onTrackTimeout = function(interest)
{
  console.log("timeout interest "+interest.getName().toUri());
 // console.log("onTrackTimeout called: " + interest.getName().toUri());
  // jb console.log("Host: " + this.face.connectionInfo.toString());
  
  // Express timeout interest; this may not be needed for track fetching:
  // we can reexpress the instant timeout happens.
  //var timeout = new Interest(new Name("/local/timeout"));
  //timeout.setInterestLifetimeMilliseconds(Config.defaultReexpressInterval);
  
  var trackId = parseInt(interest.getName().get
    (ProducerNameComponents.trackIdOffset).toEscapedString());
  var trackSeqNo = parseInt(interest.getName().get
    (ProducerNameComponents.trackSeqOffset).toEscapedString());

  if (!this.activeTracks[trackId])
  {
    console.log("onTimeout: no data for " + trackId);
    return ;
  }

  if (this.activeTracks[trackId] &&
    trackSeqNo > this.activeTracks[trackId].lastReceivedSeq)
  {
    // re-express
    //console.log('re-express '+interest.getName().toUri()+ ". last received "+this.activeTracks[trackId].lastReceivedSeq);
    this.face.expressInterest
        (interest, this.onTrackData.bind(this), this.onTrackTimeout.bind(this));
  }
};

// Expected data name: [root]/opt/[node_num]/[start_timestamp]/track_hint/[num]
Consumer.prototype.onHintData = function(interest, data)
{
  var parsedHint = JSON.parse(data.getContent().buf());
  
  for (var i = 0; i < parsedHint.tracks.length; i++) {
    var trackId = parsedHint.tracks[i].id.toString();
    if (this.activeTracks[trackId] == undefined) {
      this.activeTracks[trackId] = {"seq": parsedHint.tracks[i].seq, 
                                    "timeoutCnt": 0,
                                    "lastReceivedSeq": 0,
                                    "lastIssuedSeq": 0};
      this.fetchTrack(parsedHint.tracks[i].id, parsedHint.tracks[i].seq);
    }
  }
  // express interest for the new hint
  var hintName = new Name(this.prefix);
  hintName.append(this.startTimeComponent).append(ProducerNameComponents.trackHint);
  
  var hintInterest = new Interest(hintName);
  
  // should exclude the older one
  var exclude = new Exclude();
  
  exclude.appendAny();
  exclude.appendComponent(data.getName().get(-1));
  hintInterest.setExclude(exclude);
  
  hintInterest.setMustBeFresh(true);
  hintInterest.setInterestLifetimeMilliseconds(Config.defaultHintLifetime);
  // for hint interest, the rightMostChild is preferred.
  hintInterest.setChildSelector(1);
  
  this.face.expressInterest
    (hintInterest, this.onHintData.bind(this), this.onHintTimeout.bind(this));
};

Consumer.prototype.onHintTimeout = function(interest)
{
  console.log("onHintTimeout called: " + interest.getName().toUri());
  //jb console.log("Host: " + this.face.connectionInfo.toString());
  
  // Express timeout interest; this may not be needed for track fetching:
  // we can express the instant timeout happens.
  //var timeout = new Interest(new Name("/local/timeout"));
  //timeout.setInterestLifetimeMilliseconds(Config.defaultReexpressInterval);
  
  //jb 
  this.activeTracks = {};

  this.face.expressInterest
    (interest, this.onHintData.bind(this), this.onHintTimeout.bind(this));
};

// Meta data not yet published
Consumer.prototype.onMetaData = function(interest, data)
{ 
};

Consumer.prototype.onMetaTimeout = function(interest)
{
  console.log("onTimeout called for interest " + interest.getName().toUri());
  //jb console.log("Host: " + this.face.connectionInfo.toString());
};

Consumer.prototype.onInitialData = function(interest, data)
{
  var dataName = data.getName();
  console.log("Initial data received: " + dataName.toUri());
  
  // Data name should contain at least [full prefix] + [start_timestamp] + [tracks/track_hint]
  if (dataName.size() > this.prefix.size() + 1) {
    this.startTimeComponent = dataName.get(this.prefix.size());
    this.fetchTrackHint();
  }
  else {
    console.log("Initial interest fetched unexpected data: " + dataName.toUri());
  }
};

Consumer.prototype.onInitialTimeout = function(interest)
{
  console.log("Initial interest times out: " + interest.getName().toUri());
  
  // Express timeout interest 
  var timeout = new Interest(new Name("/local/timeout"));
  timeout.setInterestLifetimeMilliseconds(Config.initialReexpressInterval);
  
  this.face.expressInterest
    (timeout, this.dummyOnData, this.reexpressInitialInterest.bind(this));
};

Consumer.prototype.reexpressInitialInterest = function(interest)
{
  var initialInterest = new Interest(this.prefix);
  initialInterest.setMustBeFresh(true);
  initialInterest.setInterestLifetimeMilliseconds(Config.defaultInitialLifetime);
  // for initial interest, the rightMostChild is preferred
  initialInterest.setChildSelector(1);
  
  this.face.expressInterest
    (initialInterest, this.onInitialData.bind(this), this.onInitialTimeout.bind(this));
};

Consumer.prototype.dummyOnData = function(interest, data)
{
  // don't expect this to get called
  console.log("DummyOnData called.");
}

// Start fetching the track from using rightmostchild (JB) - can't start with seq 0 if we don't know if
Consumer.prototype.fetchTrack = function(trackId, seqNo)
{
  var trackName = new Name(this.prefix);
  
  trackName.append
    (this.startTimeComponent).append
    (ProducerNameComponents.tracks).append
    (trackId.toString());  // .append("0");
  
  this.activeTracks[trackId].lastIssuedSeq = seqNo + PipelineSize;
  this.pipeline(trackName, seqNo, this.activeTracks[trackId].lastIssuedSeq);
};

Consumer.prototype.pipeline = function (trackName, startSeqNo, endSeqNo)
{
  for (var seqNo = startSeqNo + 1; seqNo <= endSeqNo; seqNo++)  
  {
    var interestName = new Name(trackName);
    interestName.append(seqNo.toString());

    var trackInterest = new Interest(interestName);
    trackInterest.setMustBeFresh(true);
    this.face.expressInterest
      (trackInterest, this.onTrackData.bind(this), this.onTrackTimeout.bind(this));    
    //console.log("pipelining interest "+ trackInterest.getName().toUri())
  }
  //console.log("pipelined interests for "+trackName.toUri()+" "+startSeqNo+":"+endSeqNo);
}

Consumer.prototype.fetchTrackHint = function()
{
  var hintName = new Name(this.prefix);
  hintName.append(this.startTimeComponent).append(ProducerNameComponents.trackHint);
  
  var hintInterest = new Interest(hintName);
  hintInterest.setMustBeFresh(true);
  hintInterest.setInterestLifetimeMilliseconds(Config.defaultHintLifetime)
  this.face.expressInterest
    (hintInterest, this.onHintData.bind(this), this.onHintTimeout.bind(this));
};

/**
 * Consumer starts by issuing interest with given [root prefix]/[space name], 
 * and try to fetch the right most piece of matching data, and extract its timestamp.
 */
Consumer.prototype.start = function() {
  // fetch initial data, since consumer does not know about the value of starting time component
  var initialInterest = new Interest(this.prefix);
  initialInterest.setMustBeFresh(true);
  initialInterest.setInterestLifetimeMilliseconds(Config.defaultInitialLifetime);
  // for initial interest, the rightMostChild is preferred
  initialInterest.setChildSelector(1);
  
  this.face.expressInterest
    (initialInterest, this.onInitialData.bind(this), this.onInitialTimeout.bind(this));
};

exports.Consumer = Consumer;