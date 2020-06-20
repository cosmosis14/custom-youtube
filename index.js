const Alexa = require('ask-sdk-core')
// eslint-disable-next-line no-unused-vars
const AWS = require('aws-sdk')
const {DynamoDbPersistenceAdapter} = require('ask-sdk-dynamodb-persistence-adapter')
const persistenceAdapter = new DynamoDbPersistenceAdapter({
  tableName: 'CustomYoutubeSettings',
  createTable: true
})
const ytdl = require('ytdl-core')

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

    if (request.type === 'PlaybackController.PlayCommandIssued') {
      const message = `You just triggered ${request.type}`
      return handlerInput.responseBuilder
        .speak(message)
        .getResponse()
    }

    const songName = request.intent.slots.songName.value
    console.log(songName)

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
    const playbackInfo = await getPlaybackInfo(handlerInput)

    if (playbackInfo.inPlaybackSession) {
      return controller.stop(handlerInput)
    } else {
      const speakOutput = 'Pausing custom youtube'
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .getResponse()
    }

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
      .reprompt(speakOutput)
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
      offsetInMilliseconds
    } = playbackInfo

    // Retrieve song info with ytdl
    if (!url || !title) {
      let videoID = 'fHI8X4OXluQ'
      const ytInfo = await ytdl.getInfo('https://www.youtube.com/watch?v=' + videoID)

      let formats = ytInfo.formats
      title = ytInfo.title
      for (const format in formats) {
        if (formats[format].mimeType.includes('audio/mp4')) {
          url = formats[format].url
          break
        }
      }
    }

    const playBehavior = 'REPLACE_ALL'
    const song = {
      url: url,
      title: title
    }
    const token = '1'
    playbackInfo.nextStreamEnqueued = false

    responseBuilder
      .speak(`Now playing ${song.title}`)
      .withShouldEndSession(true)
      .addAudioPlayerPlayDirective(playBehavior, song.url, token, offsetInMilliseconds)

    // implement canThrowCard if necessary and then use here to set card content
    
    return responseBuilder.getResponse()
  },
  stop(handlerInput) {
    return handlerInput.responseBuilder
      .addAudioPlayerStopDirective()
      .getResponse
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
