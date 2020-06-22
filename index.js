const alexa = require('ask-sdk-core')
// eslint-disable-next-line no-unused-vars
const AWS = require('aws-sdk')
const {DynamoDbPersistenceAdapter} = require('ask-sdk-dynamodb-persistence-adapter')
const persistenceAdapter = new DynamoDbPersistenceAdapter({
  tableName: 'CustomYoutubeSettings',
  createTable: true
})
const axios = require('axios')
const ytdl = require('ytdl-core')

const CheckAudioInterfaceHandler = {
  async canHandle(handlerInput) {
    const audioPlayerInterface = ((((handlerInput.requestEnvelope.context || {}).System || {}).device || {}).supportedInterfaces || {}).AudioPlayer
    return audioPlayerInterface === undefined
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('Sorry, this skill is not supported on this device')
      .withShouldEndSession(true)
      .getResponse()
  }
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest'
  },
  async handle(handlerInput) {
    console.log('!!! Handling Launch !!!')
    const appSettings = await getAppSettings(handlerInput)
    let message
    let reprompt

    if (!appSettings.hasPreviousPlaybackSession) {
      message = 'Welcome to Custom Youtube, say "play", followed by a song name'
      reprompt = 'You can say "play", followed by a song name to hear music'
    } else {
      const playbackInfo = await getPlaybackInfo(handlerInput)
      message = `You were listening to ${playbackInfo.title}, would you like to resume?`
      reprompt = 'You can say "yes" to resume, or "no" to request a different song'
    }

    return handlerInput.responseBuilder
      .speak(ssmlClean(message))
      .reprompt(ssmlClean(reprompt))
      .getResponse()
  }
}
const StartAudioIntentHandler = {
  async canHandle(handlerInput) {
    let appSettings = await getAppSettings(handlerInput)

    const request = handlerInput.requestEnvelope.request

    if (!appSettings.inPlaybackSession) {
      return request.type === 'IntentRequest' &&
      request.intent.name === 'StartAudioIntent' &&
      request.intent.slots.songName.value
    }

    if (request.type === 'PlaybackController.PlayCommandIssued') {
      return true
    }

    if (request.type === 'IntentRequest') {
      return request.intent.name === 'StartAudioIntent' &&
        request.intent.slots.songName.value
    }
  },
  async handle(handlerInput) {
    console.log('!!! Handling StartAudioIntent !!!')
    const request = handlerInput.requestEnvelope.request
    let appSettings = await getAppSettings(handlerInput)
    let playbackInfo = await getPlaybackInfo(handlerInput)

    if (request.type === 'PlaybackController.PlayCommandIssued') {
      const message = `You just triggered ${request.type}`
      return handlerInput.responseBuilder
        .speak(ssmlClean(message))
        .getResponse()
    }

    const songName = request.intent.slots.songName.value
    console.log(songName)

    const videoIds = await axiosGetVideoIds(songName)
    const songInfo = await ytdlGetSong(videoIds[0])

    appSettings.videoIds = videoIds
    playbackInfo.index = 0
    playbackInfo.url = songInfo.url
    playbackInfo.title = songInfo.title
    playbackInfo.token = videoIds[0]
    playbackInfo.offsetInMilliseconds = 0

    return controller.play(handlerInput)
  }
}

const YesIntentHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput)
    const request = handlerInput.requestEnvelope.request

    return !playbackInfo.inPlaybackSession &&
      request.type === 'IntentRequest' &&
      request.intent.name === 'AMAZON.YesIntent'
  },
  handle(handlerInput) {
    console.log('!!! Handling YesIntent !!!')
    return controller.play(handlerInput)
  }
}

const NoIntentHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput)
    const request = handlerInput.requestEnvelope.request

    return !playbackInfo.inPlaybackSession &&
      request.type === 'IntentRequest' &&
      request.intent.name === 'AMAZON.NoIntent'
  },
  async handle(handlerInput) {
    console.log('!!! Handling NoIntent !!!')
    const appSettings = await getAppSettings(handlerInput)
    const playbackInfo = await getPlaybackInfo(handlerInput)

    // Playback Set
    playbackInfo.index = 0
    playbackInfo.url = ''
    playbackInfo.title = ''
    playbackInfo.offsetInMilliseconds = 0
    playbackInfo.token = ''
    appSettings.nextStreamEnqueued = false
    appSettings.hasPreviousPlaybackSession = false

    const message = 'What song would you like to hear? Say "play", followed by a song name'
    const reprompt = 'You can say "play", followed by a song name to hear music'

    return handlerInput.responseBuilder
      .speak(ssmlClean(message))
      .reprompt(ssmlClean(reprompt))
      .getResponse()
  }
}

const HelpIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
      request.intent.name === 'AMAZON.HelpIntent'
  },
  handle(handlerInput) {
    console.log('!!! Handling HelpIntent !!!')
    const speakOutput = 'The help intent will be implemented soon'

    return handlerInput.responseBuilder
      .speak(ssmlClean(speakOutput))
      .withShouldEndSession(true)
      .getResponse()
  }
}

const PausePlaybackHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request

    return request.type === 'IntentRequest' && 
      (request.intent.name === 'AMAZON.CancelIntent' ||
      request.intent.name === 'AMAZON.StopIntent' ||
      request.intent.name === 'AMAZON.PauseIntent')
  },
  async handle(handlerInput) {
    console.log('!!! Handling PausePlayback (multi intent) !!!')
    const appSettings = await getAppSettings(handlerInput)
    const playbackInfo = await getPlaybackInfo(handlerInput)

    appSettings.inPlaybackSession = false
    appSettings.hasPreviousPlaybackSession = true
    playbackInfo.offsetInMilliseconds = appSettings.latestOffsetInMilliseconds

    return controller.stop(handlerInput)

  }
}

const ResumeIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
      request.intent.name === 'AMAZON.ResumeIntent'
  },
  async handle(handlerInput) {
    const appSettings = await getAppSettings(handlerInput)
    if (appSettings.hasPreviousPlaybackSession) {
      return controller.play(handlerInput)
    } else {
      const speakOutput = 'No content to resume, please start a new Custom Youtube session'
      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    }
  }
} 

const NextIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
      request.intent.name === 'AMAZON.NextIntent'
  },
  async handle(handlerInput) {
    const appSettings = await getAppSettings(handlerInput)

    if (!appSettings.inPlaybackSession) {
      const speakOutput = 'No music is currently playing, cannot play next'
      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    } else {
      const playbackInfo = await getPlaybackInfo(handlerInput)

      // if nextPlaybackInfo is already populated...
      if (appSettings.nextStreamEnqueued && !appSettings.repeatMode) {
        const nextPlaybackInfo = await getNextPlaybackInfo(handlerInput)
        playbackInfo.index = nextPlaybackInfo.index
        playbackInfo.url = nextPlaybackInfo.url
        playbackInfo.title = nextPlaybackInfo.title
        playbackInfo.token = nextPlaybackInfo.token
        playbackInfo.offsetInMilliseconds = 0
        // else, we need to populate playbackInfo from source (ytdl)
      } else {

        // get video id and songInfo after calculating the new index
        let newIndex
        if (playbackInfo.index < appSettings.videoIds.length - 1) {
          newIndex = playbackInfo.index + 1
        } else {
          newIndex = 0
        }
        const newVideoId = appSettings.videoIds[newIndex]
        const newSongInfo = await ytdlGetSong(newVideoId)
        playbackInfo.index = newIndex
        playbackInfo.url = newSongInfo.url
        playbackInfo.title = newSongInfo.title
        playbackInfo.token = newVideoId
        playbackInfo.offsetInMilliseconds = 0        
      }

      return controller.play(handlerInput)
    }
  }
}
const PreviousIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
      request.intent.name === 'AMAZON.PreviousIntent'
  },
  async handle(handlerInput) {
    const appSettings = await getAppSettings(handlerInput)
    const playbackInfo = await getPlaybackInfo(handlerInput)

    if (!appSettings.inPlaybackSession) {
      const speakOutput = 'No music is currently playing, cannot play previous'
      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    } else if (playbackInfo.index === 0) {
      const speakOutput = 'This is the first song in the search playlist, cannot play previous'
      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    } else {
      // get video id and songInfo after calculating the new index
      const newIndex = playbackInfo.index - 1
      const newVideoId = appSettings.videoIds[newIndex]
      const newSongInfo = await ytdlGetSong(newVideoId)
      playbackInfo.index = newIndex
      playbackInfo.url = newSongInfo.url
      playbackInfo.title = newSongInfo.title
      playbackInfo.token = newVideoId
      playbackInfo.offsetInMilliseconds = 0

      return controller.play(handlerInput)
    }
  }
}
const StartOverIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
      request.intent.name === 'AMAZON.StartOverIntent'
  },
  async handle(handlerInput) {
    const appSettings = await getAppSettings(handlerInput)

    if (!appSettings.inPlaybackSession) {
      const speakOutput = 'No music is currently playing, cannot start song over'
      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    } else {
      const playbackInfo = await getPlaybackInfo(handlerInput)
      playbackInfo.offsetInMilliseconds = 0

      return controller.play(handlerInput)
    }
  }
}

const RepeatOnIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
      (request.intent.name === 'AMAZON.RepeatIntent' ||
      request.intent.name === 'RepeatOnIntent')
  },
  async handle(handlerInput) {
    const appSettings = await getAppSettings(handlerInput)

    let speakOutput
    if (!appSettings.inPlaybackSession) {
      speakOutput = 'No music is currently playing, cannot repeat the song'

      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    } else {
      speakOutput = 'Current song will now be played on repeat' 

      const playbackInfo = await getPlaybackInfo(handlerInput)
      const nextPlaybackInfo = await getNextPlaybackInfo(handlerInput)

      appSettings.repeatMode = true

      const playBehavior = 'REPLACE_ENQUEUED'
      nextPlaybackInfo.index = playbackInfo.index
      nextPlaybackInfo.url = playbackInfo.url
      nextPlaybackInfo.title = playbackInfo.title
      nextPlaybackInfo.token = playbackInfo.token
      nextPlaybackInfo.offsetInMilliseconds = 0

      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .addAudioPlayerPlayDirective(playBehavior, nextPlaybackInfo.url, nextPlaybackInfo.token, nextPlaybackInfo.offsetInMilliseconds)
        .withShouldEndSession(true)
        .getResponse()
    }
  }
}

const SongInfoIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
      request.intent.name === 'SongInfoIntent'
  },
  async handle(handlerInput) {
    const appSettings = await getAppSettings(handlerInput)
    const playbackInfo = await getPlaybackInfo(handlerInput)

    let speakOutput
    if (!appSettings.inPlaybackSession) {
      speakOutput = 'No music is currently playing, cannot get song info'
      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    } else {
      speakOutput = `This is ${playbackInfo.title}`
      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    }
  }
}

const ResetIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
      request.intent.name === 'ResetIntent'
  },
  async handle(handlerInput) {
    const appSettings = await getAppSettings(handlerInput)

    let speakOutput
    if (appSettings.inPlaybackSession) {
      speakOutput = 'Cannot reset app data while song is playing. Please tell the app to stop first'
      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .getResponse()
    } else {
      resetAttributes(handlerInput)
      speakOutput = 'Resetting app data'
      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    }
  }
  
}

const AudioPlayerEventHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type.startsWith('AudioPlayer.')
  },
  async handle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    const audioPlayerEventName = request.type.split('.')[1]
    const appSettings = await getAppSettings(handlerInput)
    let playbackInfo = await getPlaybackInfo(handlerInput)
    const nextPlaybackInfo = await getNextPlaybackInfo(handlerInput)

    switch (audioPlayerEventName) {
    case 'PlaybackStarted':
      console.log('!!! Handling PlaybackStarted !!!')

      // If we are now playing the next enqueued song, update the stored info
      if (playbackInfo.token !== request.token && nextPlaybackInfo.token === request.token) {
        playbackInfo.index = nextPlaybackInfo.index
        playbackInfo.url = nextPlaybackInfo.url
        playbackInfo.title = nextPlaybackInfo.title
        playbackInfo.token = nextPlaybackInfo.token
      }
      break
    case 'PlaybackFinished':
      appSettings.inPlaybackSession = false
      appSettings.hasPreviousPlaybackSession = false
      appSettings.nextStreamEnqueued = false
      break
    case 'PlaybackStopped':
      // This functionality for playback resume is mostly handled in the PausePlaybackHandler
      appSettings.latestOffsetInMilliseconds = getOffsetInMilliseconds(handlerInput)
      break

    case 'PlaybackNearlyFinished': {
      console.log('!!! Handling PlaybackNearlyFinished !!!')
      if (appSettings.nextStreamEnqueued) {
        break
      }

      appSettings.nextStreamEnqueued = true

      let enqueueVideoIndex
      if (appSettings.repeatMode) {
        enqueueVideoIndex = playbackInfo.index
      } else if (playbackInfo.index < appSettings.videoIds.length - 1) {
        enqueueVideoIndex = playbackInfo.index + 1
      } else {
        enqueueVideoIndex = 0
      }
      const enqueueVideoId = appSettings.videoIds[enqueueVideoIndex]

      let enqueVideoSongInfo
      if (!appSettings.repeatMode) {
        enqueVideoSongInfo = await ytdlGetSong(enqueueVideoId)
      } else {
        enqueVideoSongInfo = {
          url: playbackInfo.url,
          title: playbackInfo.title
        }
      }
      const playBehavior = 'ENQUEUE'
      const enqueueVideoUrl = enqueVideoSongInfo.url
      const enqueueToken = enqueueVideoId
      const offsetInMilliseconds = 0
      const expectedPreviousToken = playbackInfo.token

      handlerInput.responseBuilder.addAudioPlayerPlayDirective(
        playBehavior,
        enqueueVideoUrl,
        enqueueToken,
        offsetInMilliseconds,
        expectedPreviousToken
      )

      // TODO: SETUP different persistent object for enqueue info, and then on playbackstarted, set current playbackInfo object details 
      nextPlaybackInfo.index = enqueueVideoIndex
      nextPlaybackInfo.title = enqueVideoSongInfo.title
      nextPlaybackInfo.url = enqueueVideoUrl
      nextPlaybackInfo.token = enqueueToken
      break
    }

    case 'PlaybackFailed':
      playbackInfo.inPlaybackSession = false
      console.log('Playback Failed: %j', handlerInput.requestEnvelope.request.error)
      return
    
    default:
      throw new Error('Should never reach default case!')
    }
    
    return handlerInput.responseBuilder.getResponse()
  }
}

const SystemExceptionHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'System.ExceptionEncountered'
  },
  handle(handlerInput) {
    console.log(`System exception encountered: ${handlerInput.requestEnvelope.request.reason}`)
  }
}

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest'
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`)
    
    return handlerInput.responseBuilder.getResponse()
  }
}

// Generic error handling to capture any syntax or routing errors. If you receive an error
// stating the request handler chain is not found, you have not implemented a handler for
// the intent being invoked or included it in the skill builder below.
const ErrorHandler = {
  canHandle() {
    return true
  },
  handle(handlerInput, error) {
    console.log(`~~~~ Error handled: ${error.stack}`)
    // const speakOutput = 'Sorry, I had trouble doing what you asked. Please try again.'
    const speakOutput = 'Sorry, there was an error. Please check logs.'
    
    return handlerInput.responseBuilder
      .speak(ssmlClean(speakOutput))
      .getResponse()
  }
}

// The intent reflector is used for interaction model testing and debugging.
// It will simply repeat the intent the user said. You can create custom handlers
// for your intents by defining them above, then also adding them to the request
// handler chain below.
const IntentReflectorHandler = {
  canHandle(handlerInput) {
    return alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
  },
  handle(handlerInput) {
    const intentName = alexa.getIntentName(handlerInput.requestEnvelope)
    const speakOutput = `You just triggered ${intentName} with no handler`

    return handlerInput.responseBuilder
      .speak(ssmlClean(speakOutput))
    //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
      .getResponse()
  }
}

/* INTERCEPTORS */
const LoadPersistentAttributesRequestInterceptor = {
  async process(handlerInput) {
    console.log('!!! Intercepting Request !!!')
    console.log(handlerInput.requestEnvelope.request)
    const persistentAttributes = await handlerInput.attributesManager.getPersistentAttributes()
    
    // console.log(`persistentAttributes is ${persistentAttributes}`)
    // Check if user is invoking the skill the first time and initialize values
    if (Object.keys(persistentAttributes).length === 0) {
      resetAttributes(handlerInput)
    }
  }
}

const SavePersistentAttributesResponseInterceptor = {
  async process(handlerInput) {
    console.log('!!! Intercepting Response !!!')
    await handlerInput.attributesManager.savePersistentAttributes()
  }
}

/* HELPER FUNCTIONS: */

async function getAppSettings(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes()
  return attributes.appSettings
}
async function getPlaybackInfo(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes()
  return attributes.playbackInfo
}
async function getNextPlaybackInfo(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes()
  return attributes.nextPlaybackInfo
}

function getOffsetInMilliseconds(handlerInput) {
  return handlerInput.requestEnvelope.request.offsetInMilliseconds
}

async function axiosGetVideoIds(searchParam) {
  const ytApiUrlBase = 'https://www.googleapis.com/youtube/v3/search?part=snippet'

  const params = {
    // default order is 'relevance'
    // orderParamBase: '&order=',
    // orderParam: 'viewCount',

    searchParamBase: '&q=',
    searchParam: searchParam,

    typeParamBase: '&type=',
    typeParam: 'video',

    maxResultsParam: '&maxResults=',
    maxResults: 20,

    keyParamBase: '&key=',
    // keyParam: <UNCOMMENT AND INSERT YOUR YOUTUBE DATA API KEY HERE>
  }

  let query = ytApiUrlBase

  for (const key in params) {
    query += params[key]
  }
  query = encodeURI(query)
  console.log(query)
  
  const response = await axios.get(query)
  const responseItems = response.data.items
  console.log(responseItems)
  const videoIds = []
  responseItems.forEach(item => {
    videoIds.push(item.id.videoId)
  })
  return videoIds
}

async function ytdlGetSong(videoId) {
  const ytInfo = await ytdl.getInfo('https://www.youtube.com/watch?v=' + videoId)

  let formats = ytInfo.formats
  let title = ytInfo.title
  let url
  for (const format in formats) {
    if (formats[format].mimeType.includes('audio/mp4')) {
      url = formats[format].url
      break
    }
  }
  return {url, title}
}

function ssmlClean(inString) {
  let outString = inString.replace(/&/g, '&amp;')
  outString = outString.replace(/"/g, '&quot;')
  outString = outString.replace(/'/g, '&apos;')
  outString = outString.replace(/</g, '&lt;')
  outString = outString.replace(/>/g, '&gt;')

  return outString
}

function resetAttributes(handlerInput) {
  handlerInput.attributesManager.setPersistentAttributes({
    appSettings: {
      videoIds: '',
      nextStreamEnqueued: false,
      inPlaybackSession: false,
      hasPreviousPlaybackSession: false,
      repeatMode: false,
      latestOffsetInMilliseconds: 0
    },
    playbackInfo: {
      index: 0,
      url: '',
      title: '',
      offsetInMilliseconds: 0,
      token: ''
    },
    nextPlaybackInfo: {
      index: 1,
      url: '',
      title: '',
      offsetInMilliseconds: 0,
      token: ''
    }
  })
  console.log('!!! PersistentAttributes reset !!!')
}

const controller = {
  async play(handlerInput) {
    const responseBuilder = handlerInput.responseBuilder

    const playbackInfo = await getPlaybackInfo(handlerInput)
    const appSettings = await getAppSettings(handlerInput)
    let {
      url,
      title,
      token,
      offsetInMilliseconds
    } = playbackInfo

    const playBehavior = 'REPLACE_ALL'
    appSettings.inPlaybackSession = true
    appSettings.hasPreviousPlaybackSession = false
    appSettings.nextStreamEnqueued = false
    appSettings.repeatMode = false

    console.log(`playBehavior: ${playBehavior}\ntitle: ${title}\ntoken: ${token}\noffsetInMilliseconds: ${offsetInMilliseconds}\nurl: ${url}`)
    responseBuilder
      .speak(ssmlClean(`Now playing ${title}`))
      .withShouldEndSession(true)
      .addAudioPlayerPlayDirective(playBehavior, url, token, offsetInMilliseconds)

    // implement canThrowCard if necessary and then use here to set card content
    
    return responseBuilder.getResponse()
  },
  stop(handlerInput) {
    const speakOutput = 'Pausing custom youtube'
    return handlerInput.responseBuilder
      .speak(ssmlClean(speakOutput))
      .withShouldEndSession(true)
      .addAudioPlayerStopDirective()
      .getResponse()
  }
}


// The SkillBuilder acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = alexa.SkillBuilders.custom()
  .addRequestHandlers(
    CheckAudioInterfaceHandler,
    LaunchRequestHandler,
    StartAudioIntentHandler,
    YesIntentHandler,
    NoIntentHandler,
    HelpIntentHandler,
    PausePlaybackHandler,
    ResumeIntentHandler,
    NextIntentHandler,
    PreviousIntentHandler,
    StartOverIntentHandler,
    RepeatOnIntentHandler,
    SongInfoIntentHandler,
    ResetIntentHandler,
    AudioPlayerEventHandler,
    SessionEndedRequestHandler,
    SystemExceptionHandler,
    IntentReflectorHandler // make sure IntentReflectorHandler is last so it doesn't override your custom intent handlers
  )
  .addRequestInterceptors(LoadPersistentAttributesRequestInterceptor)
  .addResponseInterceptors(SavePersistentAttributesResponseInterceptor)
  .withPersistenceAdapter(persistenceAdapter)
  .addErrorHandlers(
    ErrorHandler
  )
  .lambda()
