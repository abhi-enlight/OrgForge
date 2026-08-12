import axios from 'axios'
const SF_API_VERSION = process.env.SF_API_VERSION || 'v65.0';

/**
 * Validates the instance URL.
 */
function validateInstanceUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Invalid or missing Salesforce Instance URL.');
  }
}

/**
 * Tests a deployed agent by initiating a session and sending an initial message.
 * @param {string} token 
 * @param {string} instanceUrl 
 * @param {string} agentName - The API name of the deployed agent
 * @param {string} initialMessage - The message to send to the agent
 */
async function testAgent(token, instanceUrl, agentName, initialMessage) {
  validateInstanceUrl(instanceUrl);
  
  // Einstein Agent API endpoints (adjust depending on Salesforce release version)
  const sessionUrl = `${instanceUrl}/services/data/${SF_API_VERSION}/einstein/agents/v1/sessions`;
  
  try {
    // 1. Create a session
    const sessionRes = await axios.post(
      sessionUrl,
      { agentId: agentName },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const sessionId = sessionRes.data.id;
    
    // 2. Send the message
    const messageUrl = `${instanceUrl}/services/data/${SF_API_VERSION}/einstein/agents/v1/sessions/${sessionId}/messages`;
    const msgRes = await axios.post(
      messageUrl,
      { message: { text: initialMessage } },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return {
      success: true,
      sessionId: sessionId,
      reply: msgRes.data.message?.text || msgRes.data.response || 'No text reply received',
      raw: msgRes.data
    };
    
  } catch (err) {
    console.warn(`[AgentTester] Failed to test agent ${agentName}:`, err.response?.data || err.message);
    
    // Fallback: Return a structured error response that the LLM can interpret.
    return {
      success: false,
      error: err.response?.data || [{ message: err.message }],
      note: 'The agent may not be active yet, or the org may require a newer API version for Einstein Agents.'
    };
  }
}

export { testAgent };
