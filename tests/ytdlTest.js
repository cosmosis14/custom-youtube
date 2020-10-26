const ytdl = require('ytdl-core')

const videoId = 'fHI8X4OXluQ'

ytdl.getInfo('https://www.youtube.com/watch?v=' + videoId).then((data) => {
  console.log(data.videoDetails.title)
})