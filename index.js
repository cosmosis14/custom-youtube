const Alexa = require('ask-sdk-core')
// eslint-disable-next-line no-unused-vars
const AWS = require('aws-sdk')
const {DynamoDbPersistenceAdapter} = require('ask-sdk-dynamodb-persistence-adapter')
const persistenceAdapter = new DynamoDbPersistenceAdapter({
  tableName: 'CustomYoutubeSettings',
  createTable: true
})
const Axios = require('axios')
const Ytdl = require('ytdl-core')

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest'
  },
  async handle(handlerInput) {
    console.log('!!! Handling Launch !!!')
    const playbackInfo = await getPlaybackInfo(handlerInput)
    let message
    let reprompt

    if (!playbackInfo.hasPreviousPlaybackSession) {
      message = 'Welcome to Custom Youtube, say "play", followed by a song name'
      reprompt = 'You can say "play", followed by a song name to hear music'
    } else {
      playbackInfo.inPlaybackSession = false
      message = `You were listening to ${playbackInfo.title}, would you like to resume?`
      reprompt = 'You can say "yes" to resume, or "no" to request a different song'
    }

    return handlerInput.responseBuilder
      .speak(message)
      .reprompt(reprompt)
      .getResponse()
  }
}
const StartAudioIntentHandler = {
  async canHandle(handlerInput) {
    let playbackInfo = await getPlaybackInfo(handlerInput)

    const request = handlerInput.requestEnvelope.request

    if (!playbackInfo.inPlaybackSession) {
      return request.type === 'IntentRequest' &&
      request.intent.name === 'StartAudioIntent' &&
      request.intent.slots.songName.value
    }

    if (request.type === 'PlaybackController.PlayCommandIssued') {
      return true
    }

    if (request.type === 'IntentRequest') {
      return request.intent.name === 'StartAudioIntent' ||
        request.intent.name === 'AMAZON.ResumeIntent'
    }
  },
  async handle(handlerInput) {
    console.log('!!! Handling StartAudioIntent !!!')
    const request = handlerInput.requestEnvelope.request
    let playbackInfo = await getPlaybackInfo(handlerInput)

    if (request.type === 'PlaybackController.PlayCommandIssued') {
      const message = `You just triggered ${request.type}`
      return handlerInput.responseBuilder
        .speak(message)
        .getResponse()
    }

    const songName = request.intent.slots.songName.value
    console.log(songName)

    const videoIds = await axiosGetVideoIds(songName)
    const songInfo = await ytdlGetSong(videoIds[0])

    playbackInfo.title = songInfo.title
    playbackInfo.url = songInfo.url
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
      request.intent.name === 'Amazon.YesIntent'
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
      request.intent.name === 'Amazon.NoIntent'
  },
  async handle(handlerInput) {
    console.log('!!! Handling NoIntent !!!')
    const playbackInfo = await getPlaybackInfo(handlerInput)

    // Playback Set
    // playbackInfo.index = 0
    playbackInfo.url = ''
    playbackInfo.title = ''
    playbackInfo.offsetInMilliseconds = 0
    // playbackInfo.playbackIndexChanged = true
    playbackInfo.token = ''
    playbackInfo.nextStreamEnqueued = false
    playbackInfo.hasPreviousPlaybackSession = false

    const message = 'What song would you like to hear? Say "play", followed by a song name'
    const reprompt = 'You can say "play", followed by a song name to hear music'

    return handlerInput.responseBuilder
      .speak(message)
      .reprompt(reprompt)
      .getResponse()
  }
}

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent'
  },
  handle(handlerInput) {
    console.log('!!! Handling HelpIntent !!!')
    const speakOutput = 'The help intent will be implemented soon'

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(speakOutput)
      .getResponse()
  }
}

// TODO: fix functionality here when music is playing, i.e. set playbackInfo.inPlaybackSession appropriately
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
    // const playbackInfo = await getPlaybackInfo(handlerInput)

    return controller.stop(handlerInput)

  }
}

const AudioPlayerEventHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type.startsWith('AudioPlayer.')
  },
  async handle(handlerInput) {
    const {
      requestEnvelope,
      attributesManager,
      responseBuilder
    } = handlerInput
    const audioPlayerEventName = requestEnvelope.request.type.split('.')[1]
    const {
      playbackInfo
    } = await attributesManager.getPersistentAttributes()

    switch (audioPlayerEventName) {
    case 'PlaybackStarted':
      playbackInfo.token = getToken(handlerInput)
      // TODO: Need to set playbackInfo.url & playbackInfo.title elsewhere... prob in controller.play
      playbackInfo.inPlaybackSession = true
      playbackInfo.hasPreviousPlaybackSession = true
      break
    case 'PlaybackFinished':
      playbackInfo.inPlaybackSession = false
      playbackInfo.hasPreviousPlaybackSession = false
      playbackInfo.nextStreamEnqueued = false
      break
    case 'PlaybackStopped':
      playbackInfo.token = getToken(handlerInput)
      // TODO: Need to set playbackInfo.url & playbackInfo.title elsewhere... prob in controller.play
      playbackInfo.inPlaybackSession = false
      playbackInfo.offsetInMilliseconds = getOffsetInMilliseconds(handlerInput)
      break

    case 'PlaybackNearlyFinished': {
      if (playbackInfo.nextStreamEnqueued) {
        break
      }

      // TODO: Implement auto-play of next song later
      // playbackInfo.nextStreamEnqueued = true

      // const playBehavior = 'ENQUEUE'

      break
    }

    case 'PlaybackFailed':
      playbackInfo.inPlaybackSession = false
      console.log('Playback Failed: %j', handlerInput.requestEnvelope.request.error)
      return
    
    default:
      throw new Error('Should never reach default case!')
    }
    
    return responseBuilder.getResponse()
  }
}

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest'
  },
  handle(handlerInput) {
    // Any cleanup logic goes here.
    return handlerInput.responseBuilder.getResponse()
  }
}

// The intent reflector is used for interaction model testing and debugging.
// It will simply repeat the intent the user said. You can create custom handlers
// for your intents by defining them above, then also adding them to the request
// handler chain below.
const IntentReflectorHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
  },
  handle(handlerInput) {
    const intentName = Alexa.getIntentName(handlerInput.requestEnvelope)
    const speakOutput = `You just triggered ${intentName} with no handler`

    return handlerInput.responseBuilder
      .speak(speakOutput)
    //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
      .getResponse()
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
      .speak(speakOutput)
      .getResponse()
  }
}

/* INTERCEPTORS */
const LoadPersistentAttributesRequestInterceptor = {
  async process(handlerInput) {
    console.log('!!! Intercepting Request !!!')
    const persistentAttributes = await handlerInput.attributesManager.getPersistentAttributes()
    
    // console.log(`persistentAttributes is ${persistentAttributes}`)
    // Check if user is invoking the skill the first time and initialize values
    if (Object.keys(persistentAttributes).length === 0) {
      // console.log('!!! Setting PersistentAttributes Request !!!')
      handlerInput.attributesManager.setPersistentAttributes({
        playbackSetting: {
          loop: false
          // If some version of a shuffle is to be implemented, initial setting will go here
        },

        // Playback Set
        playbackInfo: {
          // Potential play order to be implemented here
          // index: 0,
          url: '',
          title: '',
          offsetInMilliseconds: 0,
          // playbackIndexChanged: true,
          token: '',
          nextStreamEnqueued: false,
          inPlaybackSession: false,
          hasPreviousPlaybackSession: false
        }
      })
      console.log('!!! PersistentAttributes Set !!!')
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

async function getPlaybackInfo(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes()
  return attributes.playbackInfo
}

function getToken(handlerInput) {
  return handlerInput.requestEnvelope.request.token
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

    keyParamBase: '&key=',
    // keyParam: <UNCOMMENT AND INSERT YOUR YOUTUBE DATA API KEY HERE>
  }

  let query = ytApiUrlBase

  for (const key in params) {
    query += params[key]
  }
  query = encodeURI(query)
  console.log(query)
  
  const response = await Axios.get(query)
  // console.log(response.data.items)
  const responseItems = response.data.items
  const videoIds = []
  responseItems.forEach(item => {
    videoIds.push(item.id.videoId)
  })
  return videoIds
}

async function ytdlGetSong(videoId) {
  const ytInfo = await Ytdl.getInfo('https://www.youtube.com/watch?v=' + videoId)

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

const controller = {
  async play(handlerInput) {
    const {
      // attributesManager,
      responseBuilder
    } = handlerInput

    const playbackInfo = await getPlaybackInfo(handlerInput)
    let {
      url,
      title,
      token,
      offsetInMilliseconds
    } = playbackInfo

    const playBehavior = 'REPLACE_ALL'
    const song = {
      url: url,
      title: title
    }
    playbackInfo.nextStreamEnqueued = false

    responseBuilder
      .speak(`Now playing ${song.title}`)
      .withShouldEndSession(true)
      .addAudioPlayerPlayDirective(playBehavior, song.url, token, offsetInMilliseconds)

    // implement canThrowCard if necessary and then use here to set card content
    
    return responseBuilder.getResponse()
  },
  stop(handlerInput) {
    const speakOutput = 'Pausing custom youtube'
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .addAudioPlayerStopDirective()
      .getResponse()
  }
}


// The SkillBuilder acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    StartAudioIntentHandler,
    YesIntentHandler,
    NoIntentHandler,
    PausePlaybackHandler,
    HelpIntentHandler,
    AudioPlayerEventHandler,
    SessionEndedRequestHandler,
    IntentReflectorHandler // make sure IntentReflectorHandler is last so it doesn't override your custom intent handlers
  )
  .addRequestInterceptors(LoadPersistentAttributesRequestInterceptor)
  .addResponseInterceptors(SavePersistentAttributesResponseInterceptor)
  .withPersistenceAdapter(persistenceAdapter)
  .addErrorHandlers(
    ErrorHandler
  )
  .lambda()
