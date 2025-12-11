import { Injectable } from '@angular/core';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  push,
  set,
  get,
  query,
  orderByChild,
  limitToLast,
  remove,
  Database,
} from 'firebase/database';

export interface TestHistoryItem {
  id?: string;
  timestamp: number;
  averageEAR: number;
  duration: string;
  status: string;
  userId?: string;
  testId?: string; // ID test untuk tracking data EAR
  earData?: EARDataPoint[]; // Data EAR untuk grafik
  earDataSummary?: {
    minEAR: number;
    maxEAR: number;
    dataPoints: number;
  }; // Summary data EAR
}

export interface EARDataPoint {
  id?: string;
  timestamp: number;
  earValue: number;
  testId?: string; // ID test yang sedang berjalan
  userId?: string;
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseService {
  private db: Database;
  private userId: string;
  private app: FirebaseApp;

  constructor() {
    // Firebase configuration
    const firebaseConfig = {
      apiKey: "AIzaSyD_3FwNHuyXD6RGvexFXIWnlsKaLmMNGcs",
      authDomain: "ergodrivee.firebaseapp.com",
      databaseURL: "https://ergodrivee-default-rtdb.firebaseio.com",
      projectId: "ergodrivee",
      storageBucket: "ergodrivee.firebasestorage.app",
      messagingSenderId: "644396987565",
      appId: "1:644396987565:web:b287466a4a46b3b71e4224",
      measurementId: "G-XM2HE4NC2",
    };

    // Check if Firebase app already exists, if not initialize it
    if (!getApps().length) {
      this.app = initializeApp(firebaseConfig);
      console.log('Firebase initialized for the first time');
    } else {
      this.app = getApp();
      console.log('Using existing Firebase app');
    }

    // Initialize database
    this.db = getDatabase(this.app);

    // Generate or retrieve user ID (for demo purposes, using localStorage)
    this.userId = this.getUserId();
  }

  private getUserId(): string {
    let userId = localStorage.getItem('drowsiness_user_id');
    if (!userId) {
      userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('drowsiness_user_id', userId);
    }
    return userId;
  }

  // Save test history to Firebase
  async saveTestHistory(testData: Omit<TestHistoryItem, 'id'>): Promise<string> {
    try {
      const testHistoryRef = ref(this.db, `testHistory/${this.userId}`);
      const newTestRef = push(testHistoryRef);
      
      // Remove undefined values to avoid Firebase errors
      const dataToSave: any = {
        userId: this.userId,
        timestamp: testData.timestamp || Date.now(),
        averageEAR: testData.averageEAR,
        duration: testData.duration,
        status: testData.status,
      };

      // Only include testId if it's not undefined or null
      if (testData.testId) {
        dataToSave.testId = testData.testId;
      }

      // Only include earData if it exists and is not empty
      if (testData.earData && testData.earData.length > 0) {
        dataToSave.earData = testData.earData;
      }

      // Only include earDataSummary if it exists
      if (testData.earDataSummary) {
        dataToSave.earDataSummary = testData.earDataSummary;
      }

      await set(newTestRef, dataToSave);
      console.log('Test history saved successfully');
      return newTestRef.key || '';
    } catch (error) {
      console.error('Error saving test history:', error);
      throw error;
    }
  }

  // Get all test history for current user
  async getTestHistory(limit: number = 50): Promise<TestHistoryItem[]> {
    try {
      const testHistoryRef = ref(this.db, `testHistory/${this.userId}`);
      const testQuery = query(
        testHistoryRef,
        orderByChild('timestamp'),
        limitToLast(limit)
      );

      const snapshot = await get(testQuery);
      
      if (snapshot.exists()) {
        const data = snapshot.val();
        const historyArray: TestHistoryItem[] = [];

        Object.keys(data).forEach((key) => {
          historyArray.push({
            id: key,
            ...data[key],
          });
        });

        // Sort by timestamp descending (newest first)
        return historyArray.sort((a, b) => b.timestamp - a.timestamp);
      }

      return [];
    } catch (error) {
      console.error('Error getting test history:', error);
      return [];
    }
  }

  // Delete a specific test history item
  async deleteTestHistory(testId: string): Promise<void> {
    try {
      const testRef = ref(this.db, `testHistory/${this.userId}/${testId}`);
      await remove(testRef);
      console.log('Test history deleted successfully');
    } catch (error) {
      console.error('Error deleting test history:', error);
      throw error;
    }
  }

  // Clear all test history for current user
  async clearAllTestHistory(): Promise<void> {
    try {
      const testHistoryRef = ref(this.db, `testHistory/${this.userId}`);
      await remove(testHistoryRef);
      console.log('All test history cleared successfully');
    } catch (error) {
      console.error('Error clearing test history:', error);
      throw error;
    }
  }

  // Get test statistics
  async getTestStatistics(): Promise<{
    totalTests: number;
    averageEAR: number;
    mostCommonStatus: string;
  }> {
    try {
      const history = await this.getTestHistory(100);
      
      if (history.length === 0) {
        return {
          totalTests: 0,
          averageEAR: 0,
          mostCommonStatus: 'N/A',
        };
      }

      const totalEAR = history.reduce((sum, test) => sum + test.averageEAR, 0);
      const averageEAR = totalEAR / history.length;

      // Count status occurrences
      const statusCounts: { [key: string]: number } = {};
      history.forEach((test) => {
        statusCounts[test.status] = (statusCounts[test.status] || 0) + 1;
      });

      const mostCommonStatus = Object.keys(statusCounts).reduce((a, b) =>
        statusCounts[a] > statusCounts[b] ? a : b
      );

      return {
        totalTests: history.length,
        averageEAR: Number(averageEAR.toFixed(3)),
        mostCommonStatus,
      };
    } catch (error) {
      console.error('Error getting test statistics:', error);
      return {
        totalTests: 0,
        averageEAR: 0,
        mostCommonStatus: 'N/A',
      };
    }
  }

  // ========== EAR DATA FUNCTIONS ==========

  // Simpan data EAR real-time ke Firebase
  async saveEARData(earValue: number, testId?: string): Promise<string> {
    try {
      const earDataRef = ref(this.db, `earData/${this.userId}`);
      const newEarRef = push(earDataRef);
      
      const dataToSave: Omit<EARDataPoint, 'id'> = {
        timestamp: Date.now(),
        earValue: earValue,
        testId: testId || 'current',
        userId: this.userId,
      };

      await set(newEarRef, dataToSave);
      return newEarRef.key || '';
    } catch (error) {
      console.error('Error saving EAR data:', error);
      throw error;
    }
  }

  // Batch save multiple EAR data points
  async saveEARDataBatch(earDataPoints: { timestamp: number; earValue: number }[], testId?: string): Promise<void> {
    try {
      if (earDataPoints.length === 0) return;

      const earDataRef = ref(this.db, `earData/${this.userId}`);
      
      // Save each data point
      const savePromises = earDataPoints.map((dataPoint) => {
        const newEarRef = push(earDataRef);
        const dataToSave = {
          timestamp: dataPoint.timestamp,
          earValue: dataPoint.earValue,
          testId: testId || 'current',
          userId: this.userId,
        };
        return set(newEarRef, dataToSave);
      });

      await Promise.all(savePromises);
      console.log(`Saved ${earDataPoints.length} EAR data points to Firebase`);
    } catch (error) {
      console.error('Error batch saving EAR data:', error);
      throw error;
    }
  }

  // Ambil data EAR untuk grafik (dari test tertentu atau semua)
  async getEARData(testId?: string, limit: number = 100): Promise<EARDataPoint[]> {
    try {
      const earDataRef = ref(this.db, `earData/${this.userId}`);
      let earQuery = query(
        earDataRef,
        orderByChild('timestamp'),
        limitToLast(limit)
      );

    const snapshot = await get(earQuery);
    
    if (snapshot.exists()) {
      const data = snapshot.val();
      const earArray: EARDataPoint[] = [];

      Object.keys(data).forEach((key) => {
        const item = data[key];
        // Filter by testId jika diperlukan
        if (!testId || item.testId === testId) {
          earArray.push({
            id: key,
            ...item,
          });
        }
      });

      // Sort by timestamp ascending (oldest first)
      return earArray.sort((a, b) => a.timestamp - b.timestamp);
    }

    return [];
    } catch (error) {
      console.error('Error getting EAR data:', error);
      return [];
    }
  }

  // Hapus data EAR untuk test tertentu
  async deleteEARDataByTestId(testId: string): Promise<void> {
    try {
      const earDataRef = ref(this.db, `earData/${this.userId}`);
      const snapshot = await get(earDataRef);
      
      if (snapshot.exists()) {
        const data = snapshot.val();
        const deletePromises: Promise<void>[] = [];
        
        Object.keys(data).forEach((key) => {
          if (data[key].testId === testId) {
            const itemRef = ref(this.db, `earData/${this.userId}/${key}`);
            deletePromises.push(remove(itemRef));
          }
        });
        
        if (deletePromises.length > 0) {
          await Promise.all(deletePromises);
        }
      }
    } catch (error) {
      console.error('Error deleting EAR data:', error);
      throw error;
    }
  }
}   