// プロパティの取得
const SLACK_TOKEN = PropertiesService.getScriptProperties().getProperty('SLACK_TOKEN_1');
const OTHER_FORM_ID = PropertiesService.getScriptProperties().getProperty('OTHER_FORM_ID_1');
const CHANNEL_ID = PropertiesService.getScriptProperties().getProperty('channel_ID');

// 質問タイトルの定義
const ATTRIBUTE_QUESTION_TITLE = "特に質問を答えてほしい人 (複数選択可)";
const OTHER_FORM_ATTRIBUTE_QUESTION_TITLE = "該当するものを全て選択してください";
const EMAIL_QUESTION_TITLE = "メールアドレス";
const MENTION_CHANNEL_QUESTION_TITLE = "全員に向けた質問ですか？";
const MENTION_CHANNEL_ANSWER = "はい";

/**
 * メッセージ本文を作成します。
 * 特定の質問（属性に関する質問）の回答を太字にし、
 * 「全員に向けた質問ですか？」の回答が「はい」の場合は@channelを追加します。
 */
function createMessageBody(itemResponses) {
  let body = "*《以下の質問にご回答ください》*";

  itemResponses.forEach((response) => {
    const question = response.getItem().getTitle();
    let answer = response.getResponse();

    // 属性に関する質問の場合、回答を太字にする
    if (question === ATTRIBUTE_QUESTION_TITLE) {
      if (Array.isArray(answer)) {
        answer = answer.map(attr => `*${attr}*`).join(", ");
      } else {
        answer = `*${answer}*`;
      }
    }

    body += `\n\n【${question}】\n\n${answer}`;

    // 「全員に向けた質問ですか？」の回答が「はい」の場合、@channelを追加
    if (question === MENTION_CHANNEL_QUESTION_TITLE && answer === MENTION_CHANNEL_ANSWER) {
      body += "\n<!channel>";
      Logger.log("@channel をメンションしました。");
    }
  });

  return body;
}

/**
 * 特定の質問から選択された属性を取得します。
 */
function getSelectedAttributes(itemResponses) {
  let selectedAttributes = [];

  itemResponses.forEach((response) => {
    const questionTitle = response.getItem().getTitle();
    if (questionTitle === ATTRIBUTE_QUESTION_TITLE) {
      const answers = response.getResponse();
      if (Array.isArray(answers)) {
        selectedAttributes = selectedAttributes.concat(answers);
      } else {
        selectedAttributes.push(answers);
      }
    }
  });

  return selectedAttributes;
}

/**
 * 選択された属性に一致する回答者を他のフォームから検索します。
 */
function findMatchingRespondents(selectedAttributes) {
  const otherForm = FormApp.openById(OTHER_FORM_ID);
  const otherFormResponses = otherForm.getResponses();

  let matchingRespondents = [];

  otherFormResponses.forEach((response) => {
    const itemResponses = response.getItemResponses();
    let respondentAttributes = [];
    let respondentEmail = "";

    itemResponses.forEach((itemResponse) => {
      const questionTitle = itemResponse.getItem().getTitle();
      const answer = itemResponse.getResponse();

      if (questionTitle === OTHER_FORM_ATTRIBUTE_QUESTION_TITLE) {
        if (Array.isArray(answer)) {
          respondentAttributes = respondentAttributes.concat(answer);
        } else {
          respondentAttributes.push(answer);
        }
      }

      if (questionTitle === EMAIL_QUESTION_TITLE) {
        respondentEmail = answer;
      }
    });

    // 全ての選択された属性が回答者の属性に含まれているかをチェック
    const matchedAttributes = selectedAttributes.filter((attr) =>
      respondentAttributes.includes(attr)
    );
    if (matchedAttributes.length === selectedAttributes.length) {
      matchingRespondents.push({
        email: respondentEmail,
        attributes: matchedAttributes,
      });
    }
  });

  return matchingRespondents;
}

/**
 * メールアドレスからSlackユーザーIDを取得します。
 */
function getSlackUserIdByEmail(email) {
  const url = "https://slack.com/api/users.lookupByEmail?email=" + encodeURIComponent(email);
  const options = {
    method: "get",
    headers: {
      Authorization: `Bearer ${SLACK_TOKEN}`
    }
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());

    if (data.ok && data.user && data.user.id) {
      return data.user.id;
    } else {
      Logger.log(`ユーザーIDの取得に失敗しました (メール: ${email}): ${data.error}`);
      return null;
    }
  } catch (error) {
    Logger.log(`メールアドレスからユーザーIDの取得中にエラーが発生しました (メール: ${email}): ${error}`);
    return null;
  }
}

/**
 * Slackにメッセージを送信します。
 */
function sendSlackMessage(body) {
  const url = "https://slack.com/api/chat.postMessage";

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${SLACK_TOKEN}`
    },
    payload: JSON.stringify({
      channel: CHANNEL_ID,
      text: body
    })
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());
    if (!data.ok) {
      Logger.log("Slackメッセージの送信に失敗しました: " + data.error);
      // 必要に応じてエラー通知やリトライ処理を追加
    } else {
      Logger.log("Slackメッセージが正常に送信されました。");
    }
  } catch (error) {
    Logger.log("Slackメッセージの送信中にエラーが発生しました: " + error.toString());
    // 必要に応じてエラー通知やリトライ処理を追加
  }
}

/**
 * メインの関数
 */
function main(e) {
  const itemResponses = e.response.getItemResponses();
  let body = createMessageBody(itemResponses);

  const selectedAttributes = getSelectedAttributes(itemResponses);
  const matchingRespondents = findMatchingRespondents(selectedAttributes);

  // 属性が選択されていて、かつ該当者がいる場合にのみ個別メンションを追加
  if (selectedAttributes.length > 0 && matchingRespondents.length > 0) {
    let mentionText = "\n\n以下の方々にご回答をお願いします:\n";
    matchingRespondents.forEach((respondent) => {
      const userId = getSlackUserIdByEmail(respondent.email);
      if (userId) {
        mentionText += `<@${userId}> \n`;
      } else {
        // メールアドレスからユーザーIDが取得できない場合は、メールアドレスを表示するなどの処理を追加できます
        Logger.log(`ユーザーIDが取得できませんでした: ${respondent.email}`);
      }
    });
    body += mentionText;
    Logger.log("該当者にメンションしました。");
  } else {
    Logger.log("該当者がいないため、個別メンションはスキップされました。");
  }

  sendSlackMessage(body);
}
