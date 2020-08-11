/* eslint-env browser */
const log = msg =>
  document.getElementById('logs').innerHTML += msg + '<br>'

const config = {
  iceServers: [
    {
      urls: ['stun:stun3.l.google.com:19302', 'stun:stun4.l.google.com:19302']
    },
    {
      urls: 'turn:seetomorrow.tokyo:3478',
      username: 'kaiy',
      credential: 'turnTurn1'
    }
  ],
  //iceTransportPolicy: "relay",
  //iceCandidatePoolSize: 10
}

function generateUuid() {
  // https://github.com/GoogleChrome/chrome-platform-analytics/blob/master/src/internal/identifier.js
  // const FORMAT: string = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  let chars = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".split("");
  for (let i = 0, len = chars.length; i < len; i++) {
      switch (chars[i]) {
          case "x":
              chars[i] = Math.floor(Math.random() * 16).toString(16);
              break;
          case "y":
              chars[i] = (Math.floor(Math.random() * 4) + 8).toString(16);
              break;
      }
  }
  return chars.join("");
}

const id = generateUuid();

const socket = new WebSocket("ws://localhost:7000/ws");
//const socket = new WebSocket("wss://kaiy-co-dev-sfu.an.r.appspot.com/ws");
//const scheme = window.location.protocol == "https:" ? 'wss://' : 'ws://';
/*const webSocketUri =  scheme
                    + window.location.hostname
                    + (location.port ? ':'+location.port: '')
                    + '/ws';*/
//const socket = new WebSocket(webSocketUri);

let pc = new RTCPeerConnection(config)

let usedObj = {};
let streamReqIds = [];
let streamIdToObj = {};

function setEventListeners( pc ) {
  pc.ontrack = function ({ track, streams }) {
    if (track.kind === "video") {
      log("got track")

      console.log(track)
      console.log(streams)

      streamIdToObj[streams[0].id] = streams[0];

      track.onmute = async () => {
        console.log("muted")
      }

      track.onunmute = () => {
        console.log("unmuted")

        const reqId = generateUuid();

        socket.send(JSON.stringify({
          method: "stream",
          id: reqId
        }));

        streamReqIds.push(reqId)
      }

      /*track.onmute = () => {
        console.log("muted")
        if( usedObj[track.id] ) {
          let el = document.getElementById(track.id)
          document.getElementById('remoteVideos').removeChild(el)
        }
      }

      track.onunmute = () => {
        console.log("unmuted")
        usedObj[track.id] = true;

        let el = document.createElement(track.kind)
        el.srcObject = streams[0]
        el.autoplay = true
        el.id = track.id;

        document.getElementById('remoteVideos').appendChild(el)
      }*/

      const reqId = generateUuid();

      socket.send(JSON.stringify({
        method: "stream",
        id: reqId
      }));

      streamReqIds.push(reqId)
    }
  }

  pc.oniceconnectionstatechange = e => {
    log(`ICE connection state: ${pc.iceConnectionState}`)
  }
  pc.onicecandidate = event => {
    console.log(event);
    console.log("onicecandidate");

    if (event.candidate !== null) {
      console.log("send trickle");

      socket.send(JSON.stringify({
        method: "trickle",
        params: {
          candidate: event.candidate,
        }
      }))
    }
  }
}

setEventListeners(pc);

let userIdToStream = {};

socket.addEventListener('message', async (event) => {
  console.log(event.data);
  const resp = JSON.parse(event.data)

  console.log("message");
  console.log( resp.method );
  console.log( resp );

  // Listen for server renegotiation notifications
  if (!resp.id && resp.method === "offer") {
    log(`Got offer notification`)
    await pc.setRemoteDescription(resp.params)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    //const id = uuid.v4()
    const reqId = generateUuid();
    log(`Sending answer`)
    console.log("Answer", reqId);
    socket.send(JSON.stringify({
      method: "answer",
      params: { desc: answer },
      id: reqId
    }))
  }

  if (resp.method === "trickle") {
    console.log("received trickle");
    //const candidate = new RTCIceCandidate(resp.params)
    //await pc.addIceCandidate( candidate )
    //console.log( candidate );
  }

  console.log(streamReqIds)

  if( streamReqIds.some( id => id === resp.id ) || resp.method === "stream" ) {
    userIdToStream = resp.result || resp.params;

    console.log("stream request received")

    let keys = new Set()

    for( let key in usedObj )
      keys.add(key)
    for( let key in userIdToStream )
      keys.add(key)

    for( let key of keys ) if( key !== id ) {
      if( !userIdToStream.hasOwnProperty(key) ) {
        const el = document.getElementById(key);
        el.parentNode.removeChild(el);
      }

      const streamId = userIdToStream[key]
      const stream = streamIdToObj[streamId]

      console.log("media stream created")

      if( usedObj[key] ) {
        let el = document.getElementById(key);
        el.srcObject = stream
        el.autoplay = true

        console.log("video already exists")
      } else {
        usedObj[key] = true

        let divEl = document.createElement("div")

        let userEl = document.createElement("h2");
        userEl.innerText = "User UUID: "+key

        let videoEl = document.createElement("video")
        videoEl.srcObject = stream
        videoEl.autoplay = true
        videoEl.id = key

        divEl.appendChild(userEl)
        divEl.appendChild(videoEl)

        document.getElementById('remoteVideos').appendChild(divEl)

        console.log("video created")
      }
    }

    if( streamReqIds.some( id => id === resp.id ) )
      streamReqIds = streamReqIds.filter( id => id !== resp.id )
  }
})

const join = async () => {
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  //const id = uuid.v4()
  const reqId = generateUuid();

  console.log("join", reqId);

  socket.send(JSON.stringify({
    method: "join",
    params: { sid: 1234, offer: pc.localDescription },
    id: reqId
  }))

  socket.addEventListener('message', (event) => {
    console.log( event.data );
    const resp = JSON.parse(event.data)
    if (resp.id === reqId) {
      log(`Got publish answer`)
      console.log("Got publish answer")

      // Hook this here so it's not called before joining
      pc.onnegotiationneeded = async function () {
        log("Renegotiating")
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        //const id = uuid.v4()
        const reqId = generateUuid();
        console.log("offer", reqId);
        socket.send(JSON.stringify({
          method: "offer",
          params: { desc: offer },
          id: reqId
        }))

        socket.addEventListener('message', (event) => {
          const resp = JSON.parse(event.data)
          if (resp.id === reqId) {
            log(`Got renegotiation answer`)
            pc.setRemoteDescription(resp.result)
          }
        })
      }

      const reqId = generateUuid();

      socket.send(JSON.stringify({
        method: "register_stream",
        params: { uid: id, streamId: localStream.id },
        id: reqId
      }));

      console.log( resp );

      pc.setRemoteDescription(resp.result)
    }
  })
}

let localStream
let pid
navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
}).then(stream => {
  let el = document.createElement("Video")
  el.srcObject = stream
  el.autoplay = true
  el.controls = true
  el.muted = true
  document.getElementById('localVideos').appendChild(el)

  localStream = stream

  console.log(stream)
}).catch(log)

window.onload = () => {
  document.getElementById('myUuid').innerText = "My UUID: "+id;
}

window.publish = () => {
  log("Publishing stream")
  let tracks = localStream.getTracks();
  tracks = tracks.splice( 0, 2 );

  tracks.forEach((track) => {
    pc.addTrack(track, localStream);
  });

  const reqId = generateUuid();

  console.log(localStream);
  console.log(localStream.getTracks());

  join()
}

window.onclose = () => {
  const reqId = generateUuid();

  socket.send(JSON.stringify({
    method: "remove_stream",
    params: { uid: id },
    id: reqId
  }));
}