import React, { useCallback, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Platform, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { DataCacheProvider } from './src/contexts/DataCacheContext';
import { colors } from './src/theme/colors';
import LoginScreen from './src/screens/ProfessionalLoginScreen';
import FeedScreen from './src/screens/FeedScreen';
import SubjectChatScreen from './src/screens/SubjectChatScreen';
import HomeScreen from './src/screens/HomeScreen';
import GradesScreen from './src/screens/GradesScreen';
import ExamScoresScreen from './src/screens/ExamScoresScreen';
import LearnerAssessmentDetailsScreen from './src/screens/LearnerAssessmentDetailsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import InstructorTodayScreen from './src/screens/InstructorTodayScreen';
import InstructorAttendanceScreen from './src/screens/InstructorAttendanceScreen';
import InstructorGradesScreen from './src/screens/InstructorGradesScreen';
import InstructorExamScoresScreen from './src/screens/InstructorExamScoresScreen';
import InstructorProfileScreen from './src/screens/InstructorProfileScreen';
import InstructorCollectionsScreen from './src/screens/InstructorCollectionsScreen';
import PinSetupScreen from './src/screens/PinSetupScreen';
import SupportChatScreen from './src/screens/SupportChatScreen';
import AboutScreen from './src/screens/AboutScreen';
import DeleteAccountScreen from './src/screens/DeleteAccountScreen';
import ParentAccessGate from './src/components/ParentAccessGate';
import { resolveNotificationDestination } from './src/lib/notificationRouting';

const FeedStack = createNativeStackNavigator();

function FeedStackScreen() {
  return (
    <FeedStack.Navigator screenOptions={{ headerShown: false }}>
      <FeedStack.Screen name="FeedList" component={FeedScreen} />
      <FeedStack.Screen name="SubjectChat" component={SubjectChatScreen} options={{ animation: 'slide_from_right' }} />
    </FeedStack.Navigator>
  );
}

function GatedFeed(props: any) {
  return <FeedStackScreen {...props} />;
}
function GatedGrades(props: any) {
  return <GradesScreen {...props} />;
}
function GatedExamScores(props: any) {
  return <ExamScoresScreen {...props} />;
}

function GatedMainTabs() {
  return <ParentAccessGate><MainTabs /></ParentAccessGate>;
}

function AccessRestrictedScreen() {
  return <ParentAccessGate />;
}

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  const insets = useSafeAreaInsets();
  const tabBarBottomPadding = Math.max(insets.bottom, Platform.OS === 'ios' ? 24 : 10);
  const tabBarHeight = 52 + tabBarBottomPadding;

  return (
    <Tab.Navigator
      initialRouteName="Home"
      backBehavior="initialRoute"
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.98)',
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingBottom: tabBarBottomPadding,
          paddingTop: 6,
          height: tabBarHeight,
          elevation: 0,
          shadowColor: '#0f172a',
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: -2,
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Feed"
        component={GatedFeed}
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Grades"
        component={GatedGrades}
        options={{
          title: 'Grades',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'school' : 'school-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ExamScores"
        component={GatedExamScores}
        options={{
          title: 'Exams',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'clipboard' : 'clipboard-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function InstructorTabs() {
  const insets = useSafeAreaInsets();
  const tabBarBottomPadding = Math.max(insets.bottom, Platform.OS === 'ios' ? 24 : 10);
  const tabBarHeight = 52 + tabBarBottomPadding;

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.98)',
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingBottom: tabBarBottomPadding,
          paddingTop: 6,
          height: tabBarHeight,
          elevation: 0,
          shadowColor: '#0f172a',
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: -2,
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Today"
        component={InstructorTodayScreen}
        options={{
          title: 'Today',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="InstructorAttendance"
        component={InstructorAttendanceScreen}
        options={{
          title: 'Attendance',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'checkmark-done-circle' : 'checkmark-done-circle-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="InstructorGrades"
        component={InstructorGradesScreen}
        options={{
          title: 'Grades',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'school' : 'school-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="InstructorExamScores"
        component={InstructorExamScoresScreen}
        options={{
          title: 'Exams',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'clipboard' : 'clipboard-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="InstructorProfile"
        component={InstructorProfileScreen}
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function RootNavigator({ navigationRef }: { navigationRef: any }) {
  const { session, instructorUser, role, loading, needsPinSetup, hasAccess, switchChild } = useAuth();
  const handledNotificationIds = useRef(new Set<string>());

  // Log received notifications for debugging
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[Notification] Received:', JSON.stringify(notification.request.content));
    });
    return () => sub.remove();
  }, []);

  const handleNotificationTap = useCallback(
    async (data: Record<string, unknown> | undefined): Promise<boolean> => {
      if (!data || !role || loading || (role === 'parent' && !hasAccess)) return false;

      if (role === 'parent' && session) {
        const targetStudentId = typeof data.student_id === 'string' ? data.student_id : '';
        if (targetStudentId && targetStudentId !== session.student.id) {
          const isSibling = session.siblings.some(child => child.id === targetStudentId);
          if (isSibling) await switchChild(targetStudentId);
        }
      }

      const destination = resolveNotificationDestination(data, role);
      if (destination.kind === 'support') {
        navigationRef?.current?.navigate('SupportChat');
        return true;
      }

      if (destination.kind === 'assessment' && role === 'parent') {
        navigationRef?.current?.navigate('LearnerAssessmentDetails', { domain: destination.domain });
        return true;
      }

      if (destination.kind === 'chat' && role === 'parent') {
        navigationRef?.current?.navigate('Main', {
          screen: 'Feed',
          params: {
            screen: 'SubjectChat',
            params: {
              subjectId: destination.subjectId,
              subjectName: destination.subjectName,
              subjectCode: destination.subjectCode,
              instructorName: destination.instructorName,
              color: '#6366f1',
              isAdviser: destination.isAdviser,
            },
          },
        });
        return true;
      }

      const rootScreen = role === 'parent' ? 'Main' : 'InstructorMain';
      navigationRef?.current?.navigate(rootScreen, { screen: destination.kind === 'tab' ? destination.tab : role === 'parent' ? 'Feed' : 'Today' });
      return true;
    },
    [hasAccess, loading, navigationRef, role, session, switchChild]
  );

  // Listen for notification taps from the current app session. Do not replay the
  // last stored response on startup: Expo can retain it after it has already been
  // handled, which makes a normal app launch unexpectedly open an old chat.
  useEffect(() => {
    const processResponse = async (response: Notifications.NotificationResponse) => {
      const notificationId = response.notification.request.identifier;
      if (handledNotificationIds.current.has(notificationId)) return;
      const data = response.notification.request.content.data as Record<string, unknown>;
      const handled = await handleNotificationTap(data);
      if (handled) {
        handledNotificationIds.current.add(notificationId);
        await Notifications.clearLastNotificationResponseAsync().catch(() => {});
      }
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void processResponse(response);
    });

    void Notifications.clearLastNotificationResponseAsync().catch(() => {});

    return () => subscription.remove();
  }, [handleNotificationTap]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <Ionicons name="paper-plane" size={48} color={colors.primary} style={{ marginBottom: 16 }} />
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {role === 'parent' && session && !hasAccess ? (
        <Stack.Screen name="AccessRestricted" component={AccessRestrictedScreen} />
      ) : role === 'parent' && session && needsPinSetup ? (
        <Stack.Screen name="PinSetup" component={PinSetupScreen} />
      ) : role === 'parent' && session ? (
        <>
          <Stack.Screen name="Main" component={GatedMainTabs} />
          <Stack.Screen name="LearnerAssessmentDetails" component={LearnerAssessmentDetailsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="SupportChat" component={SupportChatScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="About" component={AboutScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} options={{ animation: 'slide_from_right' }} />
        </>
      ) : role === 'instructor' && instructorUser ? (
        <>
          <Stack.Screen name="InstructorMain" component={InstructorTabs} />
          <Stack.Screen name="InstructorCollections" component={InstructorCollectionsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="SupportChat" component={SupportChatScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="About" component={AboutScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} options={{ animation: 'slide_from_right' }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  const navigationRef = useRef<any>(null);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <DataCacheProvider>
          <NavigationContainer ref={navigationRef}>
            <RootNavigator navigationRef={navigationRef} />
            <StatusBar style="dark" />
          </NavigationContainer>
        </DataCacheProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
