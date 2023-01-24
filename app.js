const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");
const app = express();

app.use(express.json());

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(-1);
  }
};
initializeDBAndServer();

//Middleware function
const authenticateToken = (request, response, next) => {
  console.log("Entering Authenticate token");
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

const dbToResponseObject1 = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    dateTime: dbObject.date_time,
  };
};

//User Register API
app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
      INSERT INTO 
        user (username, name, password, gender) 
      VALUES 
        (
          '${username}', 
          '${name}',
          '${hashedPassword}', 
          '${gender}'
        )`;
      await db.run(createUserQuery);
      response.send(`User created successfully`);
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//User Login API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//List of tweets whom the user follows API
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  console.log("Entering handler");
  const { username } = request;
  const query = `
  SELECT user.username, T.tweet,T.date_time
  FROM
    (SELECT follower.following_user_id,tweet.tweet,tweet.date_time
    FROM (user JOIN follower ON user.user_id = follower.follower_user_id) AS T 
    JOIN tweet ON T.following_user_id = tweet.user_id
    WHERE user.username = '${username}'
    GROUP BY follower.following_user_id
    ORDER BY tweet.date_time DESC 
    LIMIT 4
    ) AS T JOIN user ON user.user_id = T.following_user_id
    `;
  const dbResponse = await db.all(query);
  response.send(dbResponse.map((each) => dbToResponseObject1(each)));
});

//List of names whom user follows API
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getFollowingQuery = `
  SELECT user.name
  FROM
  (SELECT follower.following_user_id
  FROM user JOIN follower ON user.user_id = follower.follower_user_id
  WHERE username = '${username}') as T JOIN user ON T.following_user_id = user.user_id
  `;
  const dbResponse = await db.all(getFollowingQuery);
  response.send(dbResponse);
});

//List of followers API

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getFollowersQuery = `
  SELECT user.name
  FROM
    (SELECT follower.follower_user_id
    FROM user JOIN follower ON user.user_id = follower.following_user_id
    WHERE username = '${username}') as T JOIN user ON T.follower_user_id = user.user_id
    `;

  const dbResponse = await db.all(getFollowersQuery);
  response.send(dbResponse);
});

//Get the requested tweet details API

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getTweetUSerId = `
    SELECT user_id
    FROM tweet
    WHERE tweet_id = ${tweetId}
    `;
  const tweetUser = await db.get(getTweetUSerId);

  const getUserFollowing = `
  SELECT follower.following_user_id
  FROM user JOIN follower ON user.user_id = follower.follower_user_id
  WHERE username = '${username}'
  `;

  const userFollowing = await db.all(getUserFollowing);

  const validationArray = userFollowing.filter(
    (each) => each.following_user_id == tweetUser.user_id
  );
  if (validationArray.length == 0) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const getTweetDetailsQuery = `
      SELECT tweet.tweet,COUNT(DISTINCT like.like_id) AS likes,COUNT(DISTINCT reply.reply_id) AS replies,tweet.date_time AS dateTime
      FROM (tweet JOIN like ON tweet.tweet_id = like.tweet_id) AS T JOIN reply ON reply.tweet_id = tweet.tweet_id
      WHERE tweet.tweet_id = ${tweetId}
      `;
    console.log(getTweetDetailsQuery);
    const finalResult = await db.get(getTweetDetailsQuery);
    response.send(finalResult);
  }
});

//List of usernames who liked a tweet API

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getTweetUSerId = `
    SELECT user_id
    FROM tweet
    WHERE tweet_id = ${tweetId}
    `;
    const tweetUser = await db.get(getTweetUSerId);

    const getUserFollowing = `
  SELECT follower.following_user_id
  FROM user JOIN follower ON user.user_id = follower.follower_user_id
  WHERE username = '${username}'
  `;

    const userFollowing = await db.all(getUserFollowing);

    const validationArray = userFollowing.filter(
      (each) => each.following_user_id == tweetUser.user_id
    );
    if (validationArray.length == 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getTweetDetailsQuery = `
      SELECT user.username
      FROM (tweet JOIN like ON tweet.tweet_id = like.tweet_id) AS T JOIN user ON user.user_id = like.user_id
      WHERE tweet.tweet_id = ${tweetId}
      `;
      console.log(getTweetDetailsQuery);
      const finalResult = await db.all(getTweetDetailsQuery);

      let finalArray = finalResult.map((each) => each.username);
      response.send({ likes: finalArray });
    }
  }
);

//List of User name,reply who replied a tweet API

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getTweetUSerId = `
    SELECT user_id
    FROM tweet
    WHERE tweet_id = ${tweetId}
    `;
    const tweetUser = await db.get(getTweetUSerId);

    const getUserFollowing = `
  SELECT follower.following_user_id
  FROM user JOIN follower ON user.user_id = follower.follower_user_id
  WHERE username = '${username}'
  `;

    const userFollowing = await db.all(getUserFollowing);

    const validationArray = userFollowing.filter(
      (each) => each.following_user_id == tweetUser.user_id
    );
    if (validationArray.length == 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getTweetDetailsQuery = `
      SELECT user.name,reply.reply
      FROM (tweet JOIN reply ON tweet.tweet_id = reply.tweet_id) AS T JOIN user ON user.user_id = reply.user_id
      WHERE tweet.tweet_id = ${tweetId}
      `;
      console.log(getTweetDetailsQuery);
      const finalResult = await db.all(getTweetDetailsQuery);

      const finalResponse = {
        replies: finalResult,
      };
      response.send(finalResponse);
    }
  }
);

//List of tweets of a user API
/*app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  /*const getAllTweetsQuery = `
SELECT tweet.tweet_id
  FROM tweet
  WHERE tweet.user_id =  (SELECT user_id FROM user WHERE username='${username}')
  `;
  const dbResponse = await db.all(getAllTweetsQuery);
  let tempArray = dbResponse.map(async (each) => {
    const tempQuery = `
      SELECT tweet.tweet, COUNT(DISTINCT like.like_id) as likes,COUNT(DISTINCT reply.reply_id) as replies,tweet.date_time AS dateTime
      FROM (tweet JOIN like ON tweet.tweet_id = like.tweet_id) AS T
      JOIN reply ON reply.tweet_id = tweet.tweet_id
      WHERE tweet.tweet_id = ${each.tweet_id}
      `;
    const tempResponse = await db.get(tempQuery);
    console.log(tempQuery);
    console.log(tempResponse);
    return tempResponse;
  });
  response.send(tempResponse); 
});*/

//List of tweets of a user

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getTweetsQuery = `SELECT 
   tweet,
   (
       SELECT COUNT(like_id)
       FROM like
       WHERE tweet_id=tweet.tweet_id
   ) AS likes,
   (
       SELECT COUNT(reply_id)
       FROM reply
       WHERE tweet_id=tweet.tweet_id  
   ) AS replies,
   date_time AS dateTime
   FROM tweet
   WHERE user_id=(SELECT user_id FROM user WHERE username='${username}')`;
  const dbResponse = await db.all(getTweetsQuery);
  response.send(dbResponse);
});

//create a tweet API

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const getUserIdQuery = `
    SELECT user_id FROM user WHERE username = '${username}'
    `;
  const userId = await db.get(getUserIdQuery);
  const addTweetQuery = `
  INSERT INTO tweet (tweet,user_id) VALUES ('${tweet}',${userId.user_id})
  `;
  const dbResponse = await db.run(addTweetQuery);
  const tweetId = dbResponse.lastID;
  response.send(`Created a Tweet`);
});

//Delete a tweet API

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getTweetUSerId = `
    SELECT user_id
    FROM tweet
    WHERE tweet_id = ${tweetId}
    `;
    const tweetUser = await db.get(getTweetUSerId);

    const getUserIdQuery = `
    SELECT user_id FROM user WHERE username = '${username}'
    `;
    const userId = await db.get(getUserIdQuery);
    if (tweetUser.user_id == userId.user_id) {
      const deleteTweetQuery = `
        DELETE FROM tweet WHERE tweet_id = ${tweetId}
        `;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;