import votation from './components/votation.js'
import utils from './utils.js'
import Vue from 'https://cdn.jsdelivr.net/npm/vue@2.6.14/dist/vue.esm.browser.js'

// eslint-disable-next-line
new Vue({
  el: '#app',

  components: { votation: votation },

  data() {
    return {
      // Map of joined votations, using id as key
      // values are client side votation objects -> { id: string, name: string, active: bool  }
      joinedVotations: {},
      // Main WebSocket instance
      ws: null,
      // Toggle to see if user is online
      online: false,
      // User object which is an instance of SWA clientPrincipal
      // See https://docs.microsoft.com/en-us/azure/static-web-apps/user-information?tabs=javascript#client-principal-data
      user: {},
      // Map of votation id to server votation objects, synced with the server
      allVotations: {},
      // Map of users to server user objects, synced with the server
      allUsers: {},
      // Are we running in a SWA
      isAzureStaticWebApp: false, 
      // Used by the new votation modal dialog
      openNewVotationDialog: false,
      newVotationName: '',
      error: '',
    }
  },

  async beforeMount() {
    // Get user details from special SWA auth endpoint
    try {
      let userRes = await fetch(`/.auth/me`)
      if (!userRes.ok) {
        throw 'Got a non-200 from to call to /.auth/me'
      } else {
        // Get user details from clientPrincipal returned from SWA
        let userData = await userRes.json()
        // Handles rare case locally when using emulator
        if (!userData.clientPrincipal) {
          document.location.href = 'login.html'
          return
        }
        this.user = userData.clientPrincipal
        this.isAzureStaticWebApp = true
      }
    } catch (err) {
      // When auth endpoint not available, fallback to a prompt and fake clientPrincipal data
      // In reality this is not really need anymore as we use the SWA emulator
      const userName = prompt('Please set your user name')
      // eslint-disable-next-line
      if (!userName) window.location.href = window.location.href
      this.user = {
        userId: utils.hashString(userName),
        userDetails: userName,
        identityProvider: 'fake',
      }
    }

    try {
      // Get all existing votations from server
      let res = await fetch(`/api/votations`)
      if (!res.ok) throw `votations error: ${await res.text()}`
      let data = await res.json()
      this.allVotations = data.votations

      // Get all existing users from server
      res = await fetch(`/api/users`)
      if (!res.ok) throw `users error: ${await res.text()}`
      data = await res.json()
      this.allUsers = data.users

      // Get URL & token to connect to Azure Web Pubsub
      res = await fetch(`/api/getToken?userId=${this.user.userId}`)
      if (!res.ok) throw `getToken error: ${await res.text()}`
      let token = await res.json()

      // Now connect to Azure Web PubSub using the URL we got
      this.ws = new WebSocket(token.url, 'json.webpubsub.azure.v1')

      // Both of these handle error situations
      this.ws.onerror = (evt) => {
        this.error = `WebSocket error ${evt.message}`
      }
      this.ws.onclose = (evt) => {
        this.error = `WebSocket closed, code: ${evt.code}`
      }

      // Custom notification event, rather that relying on the system connected event
      this.ws.onopen = () => {
        this.ws.send(
          JSON.stringify({
            type: 'event',
            event: 'userConnected',
            dataType: 'json',
            data: { userName: this.user.userDetails, userProvider: this.user.identityProvider },
          })
        )
      }
    } catch (err) {
      console.error(`API ERROR: ${err}`)
      this.error = `Failed to get data from the server ${err}, it could be down. You could try refreshing the page 🤷‍♂️`
      return
    }

    // Handle messages from server
    this.ws.addEventListener('message', (evt) => {
      let msg = JSON.parse(evt.data)

      // System events
      if (msg.type === 'system' && msg.event === 'connected') {
        utils.toastMessage(`Connected to ${evt.origin.replace('wss://', '')}`, 'success')
      }

      // Server events
      if (msg.from === 'server' && msg.data.votationEvent === 'votationCreated') {
        let votation = JSON.parse(msg.data.data)
        this.$set(this.allVotations, votation.id, votation)

        this.$nextTick(() => {
          const votationList = this.$refs.votationList
          votationList.scrollTop = votationList.scrollHeight
        })
      }

      if (msg.from === 'server' && msg.data.votationEvent === 'votationDeleted') {
        let votationId = msg.data.data
        this.$delete(this.allVotations, votationId)
        if (this.joinedVotations[votationId]) {
          utils.toastMessage(`Votation deleted by owner, you have been removed!`, 'danger')
          this.onLeaveEvent(votationId)
        }
      }

      if (msg.from === 'server' && msg.data.votationEvent === 'userOnline') {
        let newUser = JSON.parse(msg.data.data)
        // If the new user is ourselves, that means we're connected and online
        if (newUser.userId == this.user.userId) {
          this.online = true
        } else {
          utils.toastMessage(`${newUser.userName} has just joined`, 'success')
        }
        this.$set(this.allUsers, newUser.userId, newUser)
      }

      if (msg.from === 'server' && msg.data.votationEvent === 'userOffline') {
        let userId = msg.data.data
        let userName = this.allUsers[userId].userName
        this.$delete(this.allUsers, userId)
        utils.toastMessage(`${userName} has left or logged off`, 'warning')
      }

      if (msg.from === 'server' && msg.data.votationEvent === 'votationEmited') {
        let votation = JSON.parse(msg.data.data)
        this.$set(this.allVotations, votation.id, votation) 
      }
    })
  },

  methods: {
    //
    // Initiate a new votation, opens the prompt
    //
    async newVotation() {
      this.openNewVotationDialog = true
      this.$nextTick(() => {
        this.$refs.newVotationInput.focus()
      })
    },

    //
    // Called when new votation dialog is accepted
    //
    newVotationCreate() {
      this.openNewVotationDialog = false
      const votationName = this.newVotationName
      if (!votationName) return

      const votationId = utils.uuidv4()
      this.ws.send(
        JSON.stringify({
          type: 'event',
          event: 'createVotation',
          dataType: 'json',
          data: { name: votationName, id: votationId },
        })
      )
      this.newVotationName = ''
      this.deactivateVotations()
      this.joinVotation(votationId, votationName, 0, 0, 0, 0, false)
    },

    newVotationCancel() {
      this.openNewVotationDialog = false
      this.newVotationName = ''
    },

    //
    // Join a votation
    //
    async joinVotation(votationId, votationName, count, yes, no, abstention, hasVoted) {
      // Skip if we are already joined
      if (this.joinedVotations[votationId]) return

      this.deactivateVotations()
      this.$set(this.joinedVotations, votationId, { id: votationId, name: votationName, active: true, 
        count: count, yes: yes, no: no, abstention: abstention, hasVoted: hasVoted })

      this.ws.send(
        JSON.stringify({
          type: 'event',
          event: 'joinVotation',
          dataType: 'text',
          data: votationId,
        })
      )
    },

    //
    // Switch votation tab
    //
    switchVotation(evt) {
      const votationId = evt.target.getAttribute('data-votation-id')
      if (!this.joinedVotations[votationId]) return
      this.deactivateVotations()
      this.joinedVotations[votationId].active = true 
    },

    //
    // Deactivate all tabs
    //
    deactivateVotations() {
      for (let votationId in this.joinedVotations) {
        this.joinedVotations[votationId].active = false
      }
    },

    //
    // Vue event handler for when leave is clicked in child votation component
    //
    onLeaveEvent(votationId) {
      this.$delete(this.joinedVotations, votationId)
      this.ws.send(
        JSON.stringify({
          type: 'event',
          event: 'leaveVotation',
          dataType: 'json',
          data: { votationId, userName: this.user.userDetails },
        })
      )

      const firstVotation = this.joinedVotations[Object.keys(this.joinedVotations)[0]]
      if (firstVotation) {
        firstVotation.active = true
      }
    },
    
    //
    // Remove a votation if you are the owner
    //
    deleteVotation(votationId) {
      this.ws.send(
        JSON.stringify({
          type: 'event',
          event: 'deleteVotation',
          dataType: 'text',
          data: votationId,
        })
      )
    },
  },
})

