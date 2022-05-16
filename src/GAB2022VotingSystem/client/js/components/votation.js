import Vue from 'https://cdn.jsdelivr.net/npm/vue@2.6.14/dist/vue.esm.browser.js'
// eslint-disable-next-line no-undef

export default Vue.component('votation', {
  data() {
    return {
      message: '',
      connected: false,
      votations: [],
    }
  },

  props: {
    name: String,
    id: String,
    active: Boolean,
    user: Object,
    ws: WebSocket, // This is shared with the parent app component   
  },
 
  async mounted() {
    // Use addEventListener to not overwrite the existing listeners
    this.ws.addEventListener('message', (evt) => {
      let msg = JSON.parse(evt.data)

      switch (msg.type) {
        case 'message': {
          if (msg.group !== this.id) break

          // User sent messages, i.e. from sendMessage() below
          if (msg.data.message && msg.data.fromUserName) {
            this.appendVotation(msg.data.message, msg.data.fromUserName)
            break
          }

          // Other messages from the server etc
          this.appendVotation(msg.data)
          break
        }
      }
    })
  },

  methods: {
    appendVotation(text, from = null) {
      this.votations.push({
        text,
        from,
        time: new Date(),
      })

      // eslint-disable-next-line no-undef
      Vue.nextTick(() => {
        if (this.$refs['votationBox']) {
          this.$refs['votationBox'].scrollTop = this.$refs['votationBox'].scrollHeight
        }
      })
    },

    sendMessage() {
      if (!this.message) return
      this.ws.send(
        JSON.stringify({
          type: 'sendToGroup',
          group: this.id,
          dataType: 'json',
          data: {
            message: this.message,
            fromUserId: this.user.userId,
            fromUserName: this.user.userDetails,
          },
        })
      )
      this.message = ''
    },

    emitVote(vote) {       
        if (!vote) return
        this.ws.send(
          JSON.stringify({
            type: 'event',
            event: 'votationEmited',
            dataType: 'json',
            data: {
              id: this.id,
              vote: vote,
              userId: this.user.userId,
              userName: this.user.userDetails,
            },
          })
        ) 
        this.message = ''
    },
  },

  template: `
  <div class="container votationComponent" v-show="active">
    <div class="is-flex">      
      <label class="label" v-show="ws && ws.readyState === 1">What do you want to vote?</label>
      &nbsp;&nbsp;&nbsp;
     
      <p>
        <button class="button is-success" @click="emitVote('Y')" ><i class="fas fa-check-square"></i><span class="is-hidden-mobile">&nbsp; Yes</span></button>
        &nbsp;&nbsp;&nbsp;
        <button class="button is-danger" @click="emitVote('N')" ><i class="fas fa-times-circle"></i><span class="is-hidden-mobile">&nbsp; No</span></button>
        &nbsp;&nbsp;&nbsp;
        <button class="button is-warning" @click="emitVote('A')" ><i class="fas fa-exclamation-triangle"></i><span class="is-hidden-mobile">&nbsp; Abstention</span></button>
      </p>
    </div>
    
    <div class="votationBox" contentEditable="false" readonly ref="votationBox">
      <div v-for="votation of votations" class="votationMsgRow" :class="{votationRight: user.userDetails == votation.from}"> 
        <div class="card m-3 p-2 votationMsg">
          <div class="votationMsgTitle text-info" v-if="votation.from">{{ votation.from }}</div>
          <div class="votationMsgBody" v-html="votation.text"></div>
        </div>
      </div>
    </div> 
  </div>`,
})
