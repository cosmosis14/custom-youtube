const ytdl = require('ytdl-core')

const videoId = 'fHI8X4OXluQ' // Blinding Lights
// const videoId = 'sBl3QrOqsRY' // King of the Hill

ytdl.getInfo('https://www.youtube.com/watch?v=' + videoId).then((data) => {
  console.log(data.videoDetails.title)
})