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
  // iceTransportPolicy: "relay",
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

//const socket = new WebSocket("ws://localhost:7000/ws");
const socket = new WebSocket("wss://kaiy-co-dev-sfu.an.r.appspot.com/ws");
//const scheme = window.location.protocol == "https:" ? 'wss://' : 'ws://';
/*const webSocketUri =  scheme
                    + window.location.hostname
                    + (location.port ? ':'+location.port: '')
                    + '/ws';*/
//const socket = new WebSocket(webSocketUri);

const pc = new RTCPeerConnection(config)

pc.ontrack = function ({ track, streams }) {
  if (track.kind === "video") {
    log("got track")
    track.onunmute = () => {
      let el = document.createElement(track.kind)
      el.srcObject = streams[0]
      el.autoplay = true

      document.getElementById('remoteVideos').appendChild(el)
    }
  }
}

pc.oniceconnectionstatechange = e => log(`ICE connection state: ${pc.iceConnectionState}`)
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
    //const id = generateUuid();
    log(`Sending answer`)
    console.log("Answer", id);
    socket.send(JSON.stringify({
      method: "answer",
      params: { desc: answer },
      id
    }))
  }

  if (resp.method === "trickle") {
    console.log("received trickle");
    await pc.addIceCandidate( resp.params );
  }
})

const join = async () => {
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  //const id = uuid.v4()
  //const id = generateUuid();

  console.log("join", id);

  socket.send(JSON.stringify({
    method: "join",
    params: { sid: 1234, offer: pc.localDescription },
    id
  }))


  socket.addEventListener('message', (event) => {
    console.log( event.data );
    const resp = JSON.parse(event.data)
    if (resp.id === id) {
      log(`Got publish answer`)
      console.log("Got publish answer")

      // Hook this here so it's not called before joining
      pc.onnegotiationneeded = async function () {
        log("Renegotiating")
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        //const id = uuid.v4()
        //const id = generateUuid();
        console.log("offer", id);
        socket.send(JSON.stringify({
          method: "offer",
          params: { desc: offer },
          id
        }))

        socket.addEventListener('message', (event) => {
          const resp = JSON.parse(event.data)
          if (resp.id === id) {
            log(`Got renegotiation answer`)
            pc.setRemoteDescription(resp.result)
          }
        })
      }

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
}).catch(log)

window.publish = () => {
  log("Publishing stream")
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  join()
}
