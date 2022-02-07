/* eslint max-len: ["error", { "code": 122 }]*/
import "dotenv/config";
import * as functions from "firebase-functions";
import admin = require("firebase-admin");
import {TwitterApi} from "twitter-api-v2";
import {Configuration, OpenAIApi} from "openai";
import {OPENAI_PROMPTS} from "./constants";

const configuration = new Configuration({
  organization: process.env.OPEN_AI_ORG,
  apiKey: process.env.OPEN_AI_API,
});
const openai = new OpenAIApi(configuration);
admin.initializeApp();

const db = admin.firestore().doc("tokens/demo");
const twitterClient = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID || "",
  clientSecret: process.env.TWITTER_CLIENT_SECRET || "",
});

const callBackURL = "https://us-central1-twitterbot-643de.cloudfunctions.net/callback";
const tweetLengths = [32, 48, 64];
export const auth = functions.https.onRequest(async (req, res) => {
  const {url, state, codeVerifier} = twitterClient.generateOAuth2AuthLink(callBackURL, {
    scope: ["tweet.read", "tweet.write", "users.read", "offline.access"],
  });
  await db.set({codeVerifier, state});
  res.redirect(url);
});

export const callback = functions.https.onRequest(async (req, res) => {
  const state = req.query.state;
  const code = req.query.code as string;


  const dbSnap = await db.get();
  const codeVerifier = dbSnap.data()?.codeVerifier;
  const storedState = dbSnap.data()?.state;
  if (state !== storedState) {
    res.status(400).send("incorrect token");
  }
  const {accessToken, refreshToken} = await twitterClient.loginWithOAuth2({code, codeVerifier, redirectUri: callBackURL});

  await db.set({accessToken, refreshToken});
  res.sendStatus(200);
});

export const tweet = functions.https.onRequest(async (req, res) => {
  const refreshToken = (await db.get()).data()?.refreshToken;
  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);

  await db.set({accessToken, refreshToken: newRefreshToken});

  const nextTweet = await openai.createCompletion("text-davinci-001", {
    prompt: OPENAI_PROMPTS[Math.floor(Math.random() * OPENAI_PROMPTS.length)],
    max_tokens: tweetLengths[Math.floor(Math.random() * tweetLengths.length)],
  });
  const textTweet = nextTweet.data.choices && nextTweet.data.choices[0].text || "";

  const hashtags = await openai.createCompletion("text-davinci-001", {
    prompt: `Generate Hastags for the following: \n ${textTweet}`,
    max_tokens: 64,
  });
  const hashtagsTweet = hashtags.data.choices && hashtags.data.choices[0].text || "";

  refreshedClient.v2.tweet(
      `${textTweet} ${hashtagsTweet}`
  ).then((data) => res.send(data.data)).catch((err) => res.send(JSON.stringify(err)));
});


export const scheduledFunction = functions.pubsub.schedule("0 */6 * * *").onRun(async () => {
  const refreshToken = (await db.get()).data()?.refreshToken;
  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);

  await db.set({accessToken, refreshToken: newRefreshToken});
  const nextTweet = await openai.createCompletion("text-davinci-001", {
    prompt: OPENAI_PROMPTS[Math.floor(Math.random() * OPENAI_PROMPTS.length)],
    max_tokens: tweetLengths[Math.floor(Math.random() * tweetLengths.length)],
  });
  const textTweet = nextTweet.data.choices && nextTweet.data.choices[0].text || "";
  const hashtags = await openai.createCompletion("text-davinci-001", {
    prompt: `Generate Hastags for the following: \n ${textTweet}`,
    max_tokens: 64,
  });
  const hashtagsTweet = hashtags.data.choices && hashtags.data.choices[0].text || "";
  return await refreshedClient.v2.tweet(
      `${textTweet} \n ${hashtagsTweet} `
  );
});
