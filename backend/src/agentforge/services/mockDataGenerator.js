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
 * Generates mock test data by inserting records directly via the REST API.
 * @param {string} token 
 * @param {string} instanceUrl 
 * @param {string} objectName - The SObject name (e.g. 'Account', 'Case')
 * @param {Array<Object>} records - Array of field/value objects to insert
 * @returns {Array} List of insertion results
 */
async function generateMockData(token, instanceUrl, objectName, records) {
  validateInstanceUrl(instanceUrl);
  const results = [];
  
  for (const record of records) {
    try {
      const response = await axios.post(
        `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${objectName}/`,
        record,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      results.push({ success: true, id: response.data.id, errors: [] });
    } catch (err) {
      console.warn(`[MockData] Failed to insert ${objectName}:`, err.response?.data || err.message);
      results.push({ 
        success: false, 
        errors: err.response?.data || [{ message: err.message }] 
      });
    }
  }
  
  return results;
}

export { generateMockData };
