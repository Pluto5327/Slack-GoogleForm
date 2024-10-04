const SLACK_TOKEN = PropertiesService.getScriptProperties().getProperty ('SLACK_TOKEN_1');
const OTHER_FORM_ID = PropertiesService.getScriptProperties().getProperty('OTHER_FORM_ID_1');
const CHANNEL_ID = PropertiesService.getScriptProperties().getProperty('channel_ID')


/**
 * メッセージ本文を作成します。
 */
function createMessageBody(itemResponses) {
  let body = "以下の質問にご回答ください";

  itemResponses.forEach((response) => {
    const question = response.getItem().getTitle();
    const answer = response.getResponse();
    body += `\n\n【${question}】\n\n${answer}`;
  });

  return body;
}

/**
 * 特定の質問から選択された属性を取得します。
 */
function getSelectedAttributes(itemResponses) {
  const attributeQuestionTitle = "特に質問を答えてほしい人 (複数選択可)";
  let selectedAttributes = [];

  itemResponses.forEach((response) => {
    const questionTitle = response.getItem().getTitle();
    if (questionTitle === attributeQuestionTitle) {
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

  const attributeQuestionTitle = "該当するものを全て選択してください";
  const emailQuestionTitle = "メールアドレス";

  let matchingRespondents = [];

  otherFormResponses.forEach((response) => {
    const itemResponses = response.getItemResponses();
    let respondentAttributes = [];
    let respondentEmail = "";

    itemResponses.forEach((itemResponse) => {
      const questionTitle = itemResponse.getItem().getTitle();
      const answer = itemResponse.getResponse();

      if (questionTitle === attributeQuestionTitle) {
        if (Array.isArray(answer)) {
          respondentAttributes = respondentAttributes.concat(answer);
        } else {
          respondentAttributes.push(answer);
        }
      }

      if (questionTitle === emailQuestionTitle) {
        respondentEmail = answer;
      }
    });

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
 * 特定の質問に対する回答をチェックし、@channel をメンションするかを判断します。
 */
function shouldMentionChannel(itemResponses) {
  const targetQuestionTitle = "全員に向けた質問ですか？"; // ここに特定の質問のタイトルを入力
  const targetAnswer = "はい"; // ここに特定の回答を入力（例："はい"）

  for (let i = 0; i < itemResponses.length; i++) {
    const response = itemResponses[i];
    const questionTitle = response.getItem().getTitle();
    const answer = response.getResponse();

    if (questionTitle === targetQuestionTitle && answer === targetAnswer) {
      return true;
    }
  }

  return false;
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
      Logger.log(`Failed to get user ID for email ${email}: ${data.error}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Error fetching user ID for email ${email}: ${error}`);
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
      Logger.log("Error sending Slack message: " + data.error);
    }
  } catch (error) {
    Logger.log("Error sending Slack message: " + error.toString());
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
  const mentionChannel = shouldMentionChannel(itemResponses);

  if (mentionChannel) {
    body += "\n<!channel>";
  }

  if (matchingRespondents.length > 0) {
    let mentionText = "\n\n以下の方々にご回答をお願いします:\n";
    matchingRespondents.forEach((respondent) => {
      const userId = getSlackUserIdByEmail(respondent.email);
      if (userId) {
        mentionText += `<@${userId}> \n`;   // (属性: ${respondent.attributes.join(", ")})
      } else {
        // mentionText += `${respondent.email} \n`;
      }
    });
    body += mentionText;
  }

  sendSlackMessage(body);
}
