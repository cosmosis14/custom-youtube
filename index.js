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

// used to stop errors caused by db creation race conditions
let dbInitializing = false
const DbInitializingHandler = {
  // eslint-disable-next-line no-unused-vars
  canHandle(handlerInput) {
    return dbInitializing
  },
  handle(handlerInput) {
    dbInitializing = false
    const speakOutput = 'On first use, this skill takes time to initialize. Please wait ten seconds and then try the skill again. Thank you for your patience'
    return handlerInput.responseBuilder
      .speak(ssmlClean(speakOutput))
      .withShouldEndSession(true)
      .getResponse()
  }
}
// Check compatibility of device
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

// Designed to answer LaunchRequest prompts, but can be used to resume play as well
const YesIntentHandler = {
  async canHandle(handlerInput) {
    const appSettings = await getAppSettings(handlerInput)
    const request = handlerInput.requestEnvelope.request

    return !appSettings.inPlaybackSession &&
      appSettings.hasPreviousPlaybackSession &&
      request.type === 'IntentRequest' &&
      request.intent.name === 'AMAZON.YesIntent'
  },
  handle(handlerInput) {
    console.log('!!! Handling YesIntent !!!')
    return controller.play(handlerInput)
  }
}

// Designed to answer LaunchRequest prompts, but can be used to start a new search as well
const NoIntentHandler = {
  async canHandle(handlerInput) {
    const appSettings = await getAppSettings(handlerInput)
    const request = handlerInput.requestEnvelope.request

    return !appSettings.inPlaybackSession &&
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
    const speakOutput = 'This is an app to play youtube-sourced audio on alexa devices. To play audio from youtube, say alexa, ask custom youtube to play, followed by a song name, or other search term. You may also say next, previous, or start over, to edit the currently playing track. You can also ask custom youtube to repeat this song in order to put the current song on repeat mode, and replay until you tell it to stop. Saying custom youtube repeat off will cancel this. Lastly you can say ask custom youtube what song is this to get the title of the youtube video that the audio was sourced from.'

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
        let newIndex = await getNextIndex(handlerInput)
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

const RepeatOffIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
        request.intent.name === 'RepeatOffIntent'
  },
  async handle(handlerInput) {
    const appSettings = await getAppSettings(handlerInput)

    let speakOutput
    if (!appSettings.inPlaybackSession) {
      speakOutput = 'No music is currently playing, cannot change repeat mode'

      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    } else if (!appSettings.repeatMode) {
      speakOutput = 'Repeat mode is already turned off'

      return handlerInput.responseBuilder
        .speak(ssmlClean(speakOutput))
        .withShouldEndSession(true)
        .getResponse()
    } else {
      speakOutput = 'Repeat mode is now turned off'

      const playbackInfo = await getPlaybackInfo(handlerInput)
      const nextPlaybackInfo = await getNextPlaybackInfo(handlerInput)
      appSettings.repeatMode = false

      // get the info for the next song after calculating next index and videoId
      let enqueueVideoIndex = await getNextIndex(handlerInput)
      const enqueueVideoId = appSettings.videoIds[enqueueVideoIndex]
      let enqueVideoSongInfo
      enqueVideoSongInfo = await ytdlGetSong(enqueueVideoId)
      enqueVideoSongInfo = {
        url: playbackInfo.url,
        title: playbackInfo.title
      }

      // set nextPlaybackInfo and then use those values to queue the next song
      const playBehavior = 'REPLACE_ENQUEUED'
      nextPlaybackInfo.index = enqueueVideoIndex
      nextPlaybackInfo.url = enqueVideoSongInfo.url
      nextPlaybackInfo.title = enqueVideoSongInfo.title
      nextPlaybackInfo.token = enqueueVideoId.token
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
    const playbackInfo = await getPlaybackInfo(handlerInput)
    const nextPlaybackInfo = await getNextPlaybackInfo(handlerInput)

    switch (audioPlayerEventName) {
    case 'PlaybackStarted':
      console.log('!!! Handling PlaybackStarted !!!')
      appSettings.hasPreviousPlaybackSession = false

      // If we are now playing the next enqueued song, update the stored info
      if (playbackInfo.token !== request.token && nextPlaybackInfo.token === request.token) {
        playbackInfo.index = nextPlaybackInfo.index
        playbackInfo.url = nextPlaybackInfo.url
        playbackInfo.title = nextPlaybackInfo.title
        playbackInfo.token = nextPlaybackInfo.token
        playbackInfo.offsetInMilliseconds = nextPlaybackInfo.offsetInMilliseconds
      }
      break
    case 'PlaybackFinished':
      appSettings.nextStreamEnqueued = false
      break
    case 'PlaybackStopped':
      // This functionality for playback resume is mostly handled in the PausePlaybackHandler
      appSettings.latestOffsetInMilliseconds = getOffsetInMilliseconds(handlerInput)
      appSettings.hasPreviousPlaybackSession = true
      break

    case 'PlaybackNearlyFinished': {
      console.log('!!! Handling PlaybackNearlyFinished !!!')
      if (appSettings.nextStreamEnqueued) {
        break
      }

      appSettings.nextStreamEnqueued = true

      let enqueueVideoIndex
      if (appSettings.repeatMode) {
        // replay same song
        enqueueVideoIndex = playbackInfo.index
      } else {
        // get next song's index
        enqueueVideoIndex = await getNextIndex(handlerInput)
      }
      const enqueueVideoId = appSettings.videoIds[enqueueVideoIndex]
      let enqueVideoSongInfo
      if (!appSettings.repeatMode) {
        // new song data
        // console.log(`index is: ${enqueueVideoIndex}\nvideoId is: ${enqueueVideoId}`)
        enqueVideoSongInfo = await ytdlGetSong(enqueueVideoId)
      } else {
        // current song data (in repeat mode)
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

      // set nextPlaybackInfo values
      nextPlaybackInfo.index = enqueueVideoIndex
      nextPlaybackInfo.title = enqueVideoSongInfo.title
      nextPlaybackInfo.url = enqueueVideoUrl
      nextPlaybackInfo.token = enqueueToken
      nextPlaybackInfo.offsetInMilliseconds = offsetInMilliseconds

      handlerInput.responseBuilder.addAudioPlayerPlayDirective(
        playBehavior,
        enqueueVideoUrl,
        enqueueToken,
        offsetInMilliseconds,
        expectedPreviousToken
      )
      break
    }

    case 'PlaybackFailed':
      appSettings.hasPreviousPlaybackSession = false
      appSettings.inPlaybackSession = false
      appSettings.nextStreamEnqueued = false
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
  /**
   * Set initial persistent attributes data and log request info
   * @param {import('ask-sdk-core').HandlerInput} handlerInput
   */
  async process(handlerInput) {
    console.log('!!! Intercepting Request !!!')
    console.log(handlerInput.requestEnvelope.request)
    // console.log(handlerInput.requestEnvelope)

    let persistentAttributes
    try {
      persistentAttributes = await handlerInput.attributesManager.getPersistentAttributes()

      // Check if user is invoking the skill the first time and initialize values
      if (Object.keys(persistentAttributes).length === 0) {
        resetAttributes(handlerInput)
      }
      // Error will throw if the database is not initialized yet
    } catch (error) {
      console.log(error)
      dbInitializing = true
    }    
  }
}

const SavePersistentAttributesResponseInterceptor = {
  /**
   * Save persistent attributes before sending every response
   * @param {import('ask-sdk-core').HandlerInput} handlerInput
   */
  async process(handlerInput) {
    console.log('!!! Intercepting Response !!!')
    await handlerInput.attributesManager.savePersistentAttributes()
  }
}

/* HELPER FUNCTIONS: */

/**
 * Returns the appSettings object
 * @param {import('ask-sdk-core').HandlerInput} handlerInput
 * @returns {Promise<{hasPreviousPlaybackSession: boolean, inPlaybackSession: boolean, nextStreamEnqueued: boolean, repeatMode: boolean, latestOffsetInMilliseconds: number, videoIds: string[]}>} appSettings - the persistent attribute object that represents skill-wide settings
 */
async function getAppSettings(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes()
  return attributes.appSettings
}
/**
 * Returns the playbackInfo object
 * @param {import('ask-sdk-core').HandlerInput} handlerInput
 * @returns {Promise<{index: number, offsetInMilliseconds: number, title: string, url: string, token: string}>} playbackInfo - the persistent attribute object that represents characteristics of the currently playing (or paused) audio track
 */
async function getPlaybackInfo(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes()
  return attributes.playbackInfo
}
/**
 * Returns the nextPlaybackInfo object
 * @param {import('ask-sdk-core').HandlerInput} handlerInput
 * @returns {Promise<{index: number, offsetInMilliseconds: number, title: string, url: string, token: string}>} nextPlaybackInfo - the persistent attribute object that represents characteristics of the enqueued audio track
 */
async function getNextPlaybackInfo(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes()
  return attributes.nextPlaybackInfo
}
/**
 * Returns the offsetInMilliseconds of the AudioPlayer.Playback* request included in the handlerInput 
 * @param {import('ask-sdk-core').HandlerInput} handlerInput
 * @returns {number} offsetInMilliseconds - time offset for the audio track
 */
function getOffsetInMilliseconds(handlerInput) {
  return handlerInput.requestEnvelope.request.offsetInMilliseconds
}

/**
 * Returns the next index for the videoId to be played (ascending order in the videoId array)
 * @param {import('ask-sdk-core').HandlerInput} handlerInput 
 * @returns {Promise<number>} nextIndex - the index of the next videoId to fetch from youtube
 */
async function getNextIndex(handlerInput) {
  const appSettings = await getAppSettings(handlerInput)
  const playbackInfo = await getPlaybackInfo(handlerInput)

  let newIndex
  if (playbackInfo.index < appSettings.videoIds.length - 1) {
    newIndex = playbackInfo.index + 1
  } else {
    newIndex = 0
  }

  return newIndex
}

/**
 * Returns an array of youtube video ids from a youtube data api call with the search query param defined by searchParam
 * @param {string} searchParam - the search query param for the api call
 * @returns {Promise<string[]>} videoIds
 */
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

    // change length of videoIds here, max is 50
    maxResultsParam: '&maxResults=',
    maxResults: 20,

    keyParamBase: '&key=',
    // keyParam: <UNCOMMENT AND INSERT YOUR YOUTUBE DATA API KEY HERE>
  }

  let query = ytApiUrlBase

  // construct query
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

/**
 * Takes a youtube videoId and returns a url where the audio for that video is hosted, as well as the title of the original video
 * @param {string} videoId - youtube videoId; e.g https://www.youtube.com/watch?v=[videoId]
 * @returns {Promise<{url: string, title: string}>} object with two key-value pairs representing audio 'url' and 'title'
 */
async function ytdlGetSong(videoId) {
  const ytInfo = await ytdl.getInfo('https://www.youtube.com/watch?v=' + videoId)

  let formats = ytInfo.formats
  let title = ytInfo.videoDetails.title
  let url
  for (const format in formats) {
    if (formats[format].mimeType.includes('audio/mp4')) {
      url = formats[format].url
      break
    }
  }
  return {url, title}
}

/**
 * Cleans a string of any characters that could potentially break alexa's SSML interpreter
 * @param {string} inString 
 * @returns {string} outString - cleaned version of inString
 */
function ssmlClean(inString) {
  let outString = inString.replace(/&/g, '&amp;')
  outString = outString.replace(/"/g, '&quot;')
  outString = outString.replace(/'/g, '&apos;')
  outString = outString.replace(/</g, '&lt;')
  outString = outString.replace(/>/g, '&gt;')

  return outString
}

/**
 * Resets the persistent attributes in the dynamodb to default values. Used for initialization, debugging, and reference of what persistent attributes should exist in the database.
 * @param {import('ask-sdk-core').HandlerInput} handlerInput
 */
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
  /**
   * Handles the creation of a response with an AudioPlayerPlayDirective, relying on previously set playbackInfo values. Also updates certain appSettings to maintain correct state of the skill. 
   * @param {import('ask-sdk-core').HandlerInput} handlerInput 
   * @returns {Promise<import('ask-sdk-model').Response>} alexa response object
   */
  async play(handlerInput) {
    const responseBuilder = handlerInput.responseBuilder

    const appSettings = await getAppSettings(handlerInput)
    const playbackInfo = await getPlaybackInfo(handlerInput)
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
  /**
   * Handles the creation of a response with an AudioPlayerStopDirective
   * @param {import('ask-sdk-core').HandlerInput} handlerInput 
   * @returns {import('ask-sdk-model').Response} alexa response object
   */
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
    DbInitializingHandler,
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
    RepeatOffIntentHandler,
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
